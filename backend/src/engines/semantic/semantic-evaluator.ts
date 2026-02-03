import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/services/prisma.service'
import type { CvSectionType } from 'src/generated/prisma/enums'
import {
  classifySimilarityBand,
  aggregateRuleResult,
  getSectionWeight,
  sortCandidates,
  canUpgradePartialToFull,
  type SimilarityBand,
  type RuleLevelResult,
  type SimilarityThresholds,
  type CandidateForTieBreak,
  DEFAULT_SECTION_WEIGHTS,
  DEFAULT_UPGRADE_CONFIG,
} from '../similarity/similarity.contract'
import envConfig from 'src/shared/config'

/**
 * SHARED SEMANTIC EVALUATOR
 *
 * This is the SINGLE SOURCE OF TRUTH for semantic rule evaluation.
 * Used by BOTH CV Quality Engine and JD Matching Engine.
 *
 * Responsibilities:
 * - Query topK CvChunks via pgvector cosine distance
 * - Convert distance → similarity
 * - Apply SIM_FLOOR filtering
 * - Assign bands (HIGH / AMBIGUOUS / LOW / NO_EVIDENCE)
 * - Return structured evidence candidates (tie-broken deterministically)
 * - Rule-level aggregation (FULL / PARTIAL / NONE / NO_EVIDENCE)
 *
 * Does NOT do:
 * - Scoring
 * - Gap detection
 * - Suggestion generation
 * - LLM calls
 */

// =============================================================================
// TYPES
// =============================================================================

export interface EvaluationConfig {
  topK: number
  thresholds: SimilarityThresholds
  sectionWeights?: Record<CvSectionType, number>
}

export interface CandidateMatch {
  cvChunkId: string
  sectionId: string
  sectionType: CvSectionType
  chunkOrder: number
  similarity: number
  sectionWeight: number
  band: SimilarityBand
  content: string
  snippet: string // ≤100 chars
}

export interface RuleChunkEvidence {
  ruleChunkId: string
  ruleChunkContent: string
  candidates: CandidateMatch[]
  bestCandidate: CandidateMatch | null
  bestBand: SimilarityBand
}

export interface RuleEvaluationResult {
  ruleId: string
  ruleKey: string
  ruleContent: string
  chunkEvidence: RuleChunkEvidence[]
  result: RuleLevelResult
  bestMatch: CandidateMatch | null
  candidateCount: number
  upgraded: boolean // true if PARTIAL was upgraded to FULL
}

export interface SemanticEvaluationResult {
  results: RuleEvaluationResult[]
  summary: {
    total: number
    full: number
    partial: number
    none: number
    noEvidence: number
  }
}

// =============================================================================
// SERVICE
// =============================================================================

@Injectable()
export class SemanticEvaluator {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Evaluate CV chunks against CV Quality Rule chunks.
   * Returns structured evidence for each rule.
   */
  async evaluateCvQualityRules(
    cvId: string,
    ruleSetKey: string,
    config: EvaluationConfig,
  ): Promise<SemanticEvaluationResult> {
    // Get all rules from the rule set
    const ruleSet = await this.prisma.ruleSet.findUnique({
      where: { key: ruleSetKey },
      include: {
        rules: {
          where: { strategy: { in: ['SEMANTIC', 'HYBRID'] } },
          include: { chunks: true },
          orderBy: { order: 'asc' },
        },
      },
    })

    if (!ruleSet) {
      return this.emptyResult()
    }

    const results: RuleEvaluationResult[] = []

    for (const rule of ruleSet.rules) {
      const ruleResult = await this.evaluateRuleAgainstCv(
        cvId,
        rule.id,
        rule.ruleKey,
        rule.content,
        rule.chunks,
        rule.appliesToSections as CvSectionType[] | null,
        config,
      )
      results.push(ruleResult)
    }

    return this.buildSummary(results)
  }

  /**
   * Evaluate CV chunks against JD Rule chunks.
   * Used by JD Matching Engine.
   */
  async evaluateJdRules(
    cvId: string,
    jdId: string,
    config: EvaluationConfig,
  ): Promise<SemanticEvaluationResult> {
    // Get all JD rules (excluding ignored/noise)
    const jdRules = await this.prisma.jDRule.findMany({
      where: {
        jdId,
        ignored: false,
      },
      include: { chunks: true },
    })

    const results: RuleEvaluationResult[] = []

    for (const rule of jdRules) {
      const ruleResult = await this.evaluateJdRuleAgainstCv(
        cvId,
        rule.id,
        rule.content,
        rule.chunks,
        config,
      )
      results.push(ruleResult)
    }

    return this.buildSummary(results)
  }

  /**
   * Evaluate a single CV Quality rule against CV chunks.
   */
  private async evaluateRuleAgainstCv(
    cvId: string,
    ruleId: string,
    ruleKey: string,
    ruleContent: string,
    ruleChunks: Array<{ id: string; content: string; order: number }>,
    appliesToSections: CvSectionType[] | null,
    config: EvaluationConfig,
  ): Promise<RuleEvaluationResult> {
    const chunkEvidence: RuleChunkEvidence[] = []
    const allBands: SimilarityBand[] = []
    let bestOverallCandidate: CandidateMatch | null = null
    let totalCandidates = 0

    for (const ruleChunk of ruleChunks) {
      // Query CV chunks for this rule chunk
      const candidates = await this.queryCvChunksForRuleChunk(
        cvId,
        ruleChunk.id,
        'CvQualityRuleChunk',
        appliesToSections,
        config,
      )

      totalCandidates += candidates.length

      const bestCandidate = candidates.length > 0 ? candidates[0] : null
      const bestBand: SimilarityBand = bestCandidate?.band ?? 'NO_EVIDENCE'

      allBands.push(bestBand)

      chunkEvidence.push({
        ruleChunkId: ruleChunk.id,
        ruleChunkContent: ruleChunk.content,
        candidates,
        bestCandidate,
        bestBand,
      })

      // Track best overall match
      if (bestCandidate && (!bestOverallCandidate || bestCandidate.similarity > bestOverallCandidate.similarity)) {
        bestOverallCandidate = bestCandidate
      }
    }

    // Aggregate rule-level result
    let result = aggregateRuleResult(allBands)
    let upgraded = false

    // Check for PARTIAL → FULL upgrade
    if (result === 'PARTIAL' && bestOverallCandidate) {
      const candidatesAboveLow = chunkEvidence.reduce(
        (sum, ce) => sum + ce.candidates.filter((c) => c.similarity >= config.thresholds.low).length,
        0,
      )

      if (canUpgradePartialToFull(
        { sectionType: bestOverallCandidate.sectionType, similarity: bestOverallCandidate.similarity },
        candidatesAboveLow,
        config.thresholds,
        DEFAULT_UPGRADE_CONFIG,
      )) {
        result = 'FULL'
        upgraded = true
      }
    }

    return {
      ruleId,
      ruleKey,
      ruleContent,
      chunkEvidence,
      result,
      bestMatch: bestOverallCandidate,
      candidateCount: totalCandidates,
      upgraded,
    }
  }

  /**
   * Evaluate a single JD rule against CV chunks.
   */
  private async evaluateJdRuleAgainstCv(
    cvId: string,
    ruleId: string,
    ruleContent: string,
    ruleChunks: Array<{ id: string; content: string; order?: number }>,
    config: EvaluationConfig,
  ): Promise<RuleEvaluationResult> {
    const chunkEvidence: RuleChunkEvidence[] = []
    const allBands: SimilarityBand[] = []
    let bestOverallCandidate: CandidateMatch | null = null
    let totalCandidates = 0

    for (const ruleChunk of ruleChunks) {
      // Query CV chunks for this JD rule chunk
      const candidates = await this.queryCvChunksForRuleChunk(
        cvId,
        ruleChunk.id,
        'JDRuleChunk',
        null, // JD rules apply globally
        config,
      )

      totalCandidates += candidates.length

      const bestCandidate = candidates.length > 0 ? candidates[0] : null
      const bestBand: SimilarityBand = bestCandidate?.band ?? 'NO_EVIDENCE'

      allBands.push(bestBand)

      chunkEvidence.push({
        ruleChunkId: ruleChunk.id,
        ruleChunkContent: ruleChunk.content,
        candidates,
        bestCandidate,
        bestBand,
      })

      // Track best overall match
      if (bestCandidate && (!bestOverallCandidate || bestCandidate.similarity > bestOverallCandidate.similarity)) {
        bestOverallCandidate = bestCandidate
      }
    }

    // Aggregate rule-level result
    let result = aggregateRuleResult(allBands)
    let upgraded = false

    // Check for PARTIAL → FULL upgrade
    if (result === 'PARTIAL' && bestOverallCandidate) {
      const candidatesAboveLow = chunkEvidence.reduce(
        (sum, ce) => sum + ce.candidates.filter((c) => c.similarity >= config.thresholds.low).length,
        0,
      )

      if (canUpgradePartialToFull(
        { sectionType: bestOverallCandidate.sectionType, similarity: bestOverallCandidate.similarity },
        candidatesAboveLow,
        config.thresholds,
        DEFAULT_UPGRADE_CONFIG,
      )) {
        result = 'FULL'
        upgraded = true
      }
    }

    return {
      ruleId,
      ruleKey: ruleId, // JD rules don't have separate keys
      ruleContent,
      chunkEvidence,
      result,
      bestMatch: bestOverallCandidate,
      candidateCount: totalCandidates,
      upgraded,
    }
  }

  /**
   * Query CV chunks for a rule chunk using pgvector.
   * Returns candidates sorted by deterministic tie-break order.
   */
  private async queryCvChunksForRuleChunk(
    cvId: string,
    ruleChunkId: string,
    ruleChunkTable: 'CvQualityRuleChunk' | 'JDRuleChunk',
    appliesToSections: CvSectionType[] | null,
    config: EvaluationConfig,
  ): Promise<CandidateMatch[]> {
    const { topK, thresholds, sectionWeights = DEFAULT_SECTION_WEIGHTS } = config

    // Query using pgvector cosine distance
    // Use separate queries based on table type
    let rows: Array<{
      cv_chunk_id: string
      section_id: string
      section_type: CvSectionType
      chunk_order: number
      content: string
      distance: number
    }>

    if (ruleChunkTable === 'CvQualityRuleChunk') {
      rows = await this.prisma.$queryRaw`
        SELECT
          cc.id as cv_chunk_id,
          cs.id as section_id,
          cs.type as section_type,
          cc."order" as chunk_order,
          cc.content,
          cc.embedding <=> rc.embedding as distance
        FROM "CvChunk" cc
        JOIN "CvSection" cs ON cs.id = cc."sectionId"
        JOIN "CvQualityRuleChunk" rc ON rc.id = ${ruleChunkId}
        WHERE cs."cvId" = ${cvId}
          AND cc.embedding IS NOT NULL
          AND rc.embedding IS NOT NULL
        ORDER BY cc.embedding <=> rc.embedding ASC
        LIMIT ${topK * 2}
      `
    } else {
      rows = await this.prisma.$queryRaw`
        SELECT
          cc.id as cv_chunk_id,
          cs.id as section_id,
          cs.type as section_type,
          cc."order" as chunk_order,
          cc.content,
          cc.embedding <=> rc.embedding as distance
        FROM "CvChunk" cc
        JOIN "CvSection" cs ON cs.id = cc."sectionId"
        JOIN "JDRuleChunk" rc ON rc.id = ${ruleChunkId}
        WHERE cs."cvId" = ${cvId}
          AND cc.embedding IS NOT NULL
          AND rc.embedding IS NOT NULL
        ORDER BY cc.embedding <=> rc.embedding ASC
        LIMIT ${topK * 2}
      `
    }

    // Convert to candidates with similarity and filtering
    const candidates: CandidateMatch[] = []

    for (const row of rows) {
      const similarity = 1 - row.distance // cosine distance → similarity

      // Apply SIM_FLOOR
      if (similarity < thresholds.floor) continue

      const sectionWeight = getSectionWeight(
        row.section_type,
        appliesToSections,
        0.1, // boost amount for matching sections
      )

      const band = classifySimilarityBand(similarity, thresholds)

      candidates.push({
        cvChunkId: row.cv_chunk_id,
        sectionId: row.section_id,
        sectionType: row.section_type,
        chunkOrder: row.chunk_order,
        similarity,
        sectionWeight,
        band,
        content: row.content,
        snippet: row.content.slice(0, 100),
      })
    }

    // Sort by deterministic tie-break order
    const sortedCandidates = sortCandidates(
      candidates.map((c) => ({
        ...c,
        chunkId: c.cvChunkId,
      })),
    )

    // Return top K after sorting
    return sortedCandidates.slice(0, topK) as CandidateMatch[]
  }

  /**
   * Build summary from results
   */
  private buildSummary(results: RuleEvaluationResult[]): SemanticEvaluationResult {
    const summary = {
      total: results.length,
      full: results.filter((r) => r.result === 'FULL').length,
      partial: results.filter((r) => r.result === 'PARTIAL').length,
      none: results.filter((r) => r.result === 'NONE').length,
      noEvidence: results.filter((r) => r.result === 'NO_EVIDENCE').length,
    }

    return { results, summary }
  }

  /**
   * Return empty result
   */
  private emptyResult(): SemanticEvaluationResult {
    return {
      results: [],
      summary: { total: 0, full: 0, partial: 0, none: 0, noEvidence: 0 },
    }
  }

  /**
   * Get default evaluation config from env
   */
  static getDefaultConfig(): EvaluationConfig {
    return {
      topK: envConfig.MATCH_TOP_K,
      thresholds: {
        floor: envConfig.SIM_FLOOR,
        low: envConfig.SIM_LOW_THRESHOLD,
        high: envConfig.SIM_HIGH_THRESHOLD,
      },
      sectionWeights: DEFAULT_SECTION_WEIGHTS,
    }
  }
}
