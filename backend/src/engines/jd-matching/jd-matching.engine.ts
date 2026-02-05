import { Injectable } from '@nestjs/common'
import { CvRepo } from 'src/routes/cv/cv.repo'
import { JdRepo } from 'src/routes/jd/jd.repo'
import type { VectorMatchCandidate } from 'src/shared/services/vector-search.service'
import { GeminiJudgeService } from 'src/shared/services/gemini-judge.service'
import type { JdMatchResultDTO, MatchTraceEntryDTO, GapDTO, SuggestionDTO } from 'src/routes/evaluation/evaluation.dto'
import type {
  JdMatchLevelType,
  SimilarityBandType,
  RuleCategoryType,
  MatchStatusType,
  GapSeverityType,
} from 'src/routes/evaluation/evaluation.model'
import {
  JD_MATCHING_RULE_SET_VERSION,
  MATCH_STATUS_SCORES,
  RULE_TYPE_MULTIPLIERS,
  RULE_TYPE_WEIGHTS,
  BAND_TO_MATCH_STATUS,
  UPGRADE_ELIGIBLE_SECTIONS,
  MATCH_LEVEL_THRESHOLDS,
  GAP_ELIGIBLE_RULE_TYPES,
  GAP_SEVERITY,
  SUGGESTION_ACTION_TYPES,
} from 'src/rules/student-fresher/jd-matching.rules'
import { SemanticEvaluator } from 'src/engines/semantic/semantic-evaluator'
import {
  classifySimilarityBand,
  aggregateRuleResult,
  canUpgradePartialToFull,
  getGapSeverity,
  SimilarityBand,
  SimilarityThresholds,
} from 'src/engines/similarity/similarity.contract'
import envConfig from 'src/shared/config'

/**
 * JD Matching Engine (Refactored for AMBIGUOUS-aware matching)
 *
 * CRITICAL PRINCIPLES:
 * 1. AMBIGUOUS similarity does NOT mean failure
 * 2. For fresher CVs, AMBIGUOUS means "relevant but under-expressed"
 * 3. All decisions are at RULE level, not chunk level
 * 4. LLM judge is OPTIONAL - AMBIGUOUS never degrades to NONE without judge
 *
 * Responsibilities:
 * - Vector match JDRuleChunk ↔ CvChunk (cosine similarity)
 * - Similarity band classification: HIGH | AMBIGUOUS | LOW
 * - Rule-level match status: FULL | PARTIAL | NONE
 * - Section-aware upgrade for PROJECTS/EXPERIENCE
 * - Optional Gemini judge only for AMBIGUOUS refinement
 * - Deterministic gap detection + suggestion generation + scoring
 *
 * Forbidden:
 * - Any CV quality logic
 * - Modifying CV quality decisions
 * - Treating AMBIGUOUS as NONE by default
 */
@Injectable()
export class JdMatchingEngine {
  constructor(
    private readonly cvRepo: CvRepo,
    private readonly jdRepo: JdRepo,
    private readonly geminiJudgeService: GeminiJudgeService,
    private readonly semanticEvaluator: SemanticEvaluator,
  ) { }

  async evaluate(
    cvId: string,
    jdId: string,
    config: {
      topK: number
      simFloor: number
      simLowThreshold: number
      simHighThreshold: number
      llmJudgeEnabled: boolean
    },
  ): Promise<JdMatchResultDTO> {
    // Load JD rules with chunks
    const jdRules = await this.jdRepo.findRulesByJdId(jdId)

    // Stage 12: Semantic evaluation using DB embeddings (CvChunk ↔ JDRuleChunk)
    // We then adapt the semantic evaluator candidates into the legacy matchResults map
    // so the rest of the deterministic rule-level logic remains unchanged.
    const semantic = await this.semanticEvaluator.evaluateJdRules(cvId, jdId, {
      topK: config.topK,
      thresholds: {
        floor: config.simFloor,
        low: config.simLowThreshold,
        high: config.simHighThreshold,
      },
    })

    const matchResults = new Map<string, VectorMatchCandidate[]>()
    for (const ruleResult of semantic.results) {
      for (const ce of ruleResult.chunkEvidence) {
        matchResults.set(
          ce.ruleChunkId,
          ce.candidates.map((c) => ({
            cvChunkId: c.cvChunkId,
            sectionId: c.sectionId,
            sectionType: c.sectionType,
            content: c.content,
            score: c.similarity,
          })),
        )
      }
    }

    const matchTrace: MatchTraceEntryDTO[] = []
    const gaps: GapDTO[] = []
    const suggestions: SuggestionDTO[] = []

    // Process each RULE (not each chunk) - TASK 4: Rule-level decisions
    let suggestionIndex = 0
    for (const rule of jdRules) {
      const ruleResult = await this.processRule(rule, matchResults, config, jdId, suggestionIndex)
      matchTrace.push(ruleResult.traceEntry)

      // TASK 6: Strict gap detection
      if (ruleResult.gap) {
        gaps.push(ruleResult.gap)
      }

      // TASK 7: AMBIGUOUS-aware suggestions
      if (ruleResult.suggestion) {
        suggestions.push(ruleResult.suggestion)
        suggestionIndex++
      }
    }

    // Stage 17: JD Match Scoring with weighted scores
    const level = this.calculateMatchLevel(matchTrace, jdRules)
    const scores = this.calculateScores(matchTrace, jdRules)

    return {
      level,
      matchTrace,
      gaps,
      suggestions,
      scores,
    }
  }

  /**
   * Process a single JD rule and determine its match status
   * TASK 4: Rule-level decision (not chunk-level)
   */
  private async processRule(
    rule: { id: string; ruleType: string; content: string; chunks: Array<{ id: string; content: string }> },
    matchResults: Map<string, VectorMatchCandidate[]>,
    config: {
      topK: number
      simFloor: number
      simLowThreshold: number
      simHighThreshold: number
      llmJudgeEnabled: boolean
    },
    jdId: string,
    suggestionIndex: number,
  ): Promise<{
    traceEntry: MatchTraceEntryDTO
    gap: GapDTO | null
    suggestion: SuggestionDTO | null
  }> {
    const chunkEvidence: Array<{
      ruleChunkId: string
      ruleChunkContent: string
      candidates: Array<{
        cvChunkId: string
        sectionId: string
        sectionType: string
        score: number
        band: SimilarityBandType
      }>
      bestCandidate: {
        cvChunkId: string
        sectionId: string
        sectionType: string
        score: number
        band: SimilarityBandType
        content?: string
      } | null
      bandStatus: SimilarityBandType | null
      judgeUsed: boolean
      judgeSkipped: boolean
      judgeUnavailable: boolean
      judgeResult: { relevant: boolean; reason: string; confidence?: 'low' | 'medium' | 'high' } | null
    }> = []

    let bestOverallMatch: {
      ruleChunkId: string
      cvChunkId: string
      sectionType: string
      score: number
      band: SimilarityBandType
      content?: string
    } | null = null

    const thresholds: SimilarityThresholds = {
      floor: config.simFloor,
      low: config.simLowThreshold,
      high: config.simHighThreshold,
    }

    // Process each chunk to gather evidence
    for (const ruleChunk of rule.chunks) {
      const candidates = matchResults.get(ruleChunk.id) || []

      // Stage 13: Band classification and floor filtering
      const bandedCandidates = candidates
        .filter((c) => c.score >= config.simFloor)
        .map((c) => ({
          cvChunkId: c.cvChunkId,
          sectionId: c.sectionId,
          sectionType: c.sectionType,
          score: c.score,
          band: classifySimilarityBand(c.score, thresholds) as SimilarityBandType,
          content: c.content,
        }))

      const bestCandidate = bandedCandidates.length > 0 ? bandedCandidates[0] : null

      // Stage 14: Optional LLM judge for AMBIGUOUS (TASK 3)
      let judgeUsed = false
      let judgeSkipped = false
      let judgeUnavailable = false
      let judgeResult: { relevant: boolean; reason: string; confidence?: 'low' | 'medium' | 'high' } | null = null

      if (bestCandidate && bestCandidate.band === 'AMBIGUOUS' && config.llmJudgeEnabled) {
        try {
          const judgeResponse = await this.geminiJudgeService.judge({
            ruleChunkContent: ruleChunk.content,
            cvChunkContent: bestCandidate.content || '',
            sectionType: bestCandidate.sectionType,
          })

          judgeUsed = judgeResponse.used
          judgeSkipped = judgeResponse.skipped
          judgeResult = judgeResponse.result
        } catch {
          // Judge unavailable - AMBIGUOUS remains PARTIAL
          judgeUnavailable = true
        }
      } else if (bestCandidate && bestCandidate.band === 'AMBIGUOUS') {
        judgeSkipped = true
      }

      chunkEvidence.push({
        ruleChunkId: ruleChunk.id,
        ruleChunkContent: ruleChunk.content,
        candidates: bandedCandidates.map((c) => ({
          cvChunkId: c.cvChunkId,
          sectionId: c.sectionId,
          sectionType: c.sectionType,
          score: c.score,
          band: c.band,
        })),
        bestCandidate: bestCandidate
          ? {
            cvChunkId: bestCandidate.cvChunkId,
            sectionId: bestCandidate.sectionId,
            sectionType: bestCandidate.sectionType,
            score: bestCandidate.score,
            band: bestCandidate.band,
          }
          : null,
        bandStatus: bestCandidate?.band || null,
        judgeUsed,
        judgeSkipped,
        judgeUnavailable,
        judgeResult,
      })

      // Track best overall match across all chunks
      if (bestCandidate) {
        if (!bestOverallMatch || bestCandidate.score > bestOverallMatch.score) {
          bestOverallMatch = {
            ruleChunkId: ruleChunk.id,
            cvChunkId: bestCandidate.cvChunkId,
            sectionType: bestCandidate.sectionType,
            score: bestCandidate.score,
            band: bestCandidate.band,
            content: bestCandidate.content,
          }
        }
      }
    }

    // Task 2.5: Multi-mention aggregation
    // Count unique high-similarity matches to boost confidence for skills mentioned multiple times
    const allCandidates = chunkEvidence.flatMap((e) => e.candidates)

    // Deduplicate very similar CV chunks (avoid counting same content multiple times)
    const uniqueCandidates: typeof allCandidates = []
    const dedupThreshold = envConfig.DEDUP_SIMILARITY_THRESHOLD

    for (const candidate of allCandidates) {
      const isDuplicate = uniqueCandidates.some(
        (existing) =>
          existing.cvChunkId === candidate.cvChunkId ||
          (existing.sectionId === candidate.sectionId &&
            Math.abs(existing.score - candidate.score) < (1 - dedupThreshold))
      )
      if (!isDuplicate) {
        uniqueCandidates.push(candidate)
      }
    }

    // Count mentions by similarity range
    const highSimilarityThreshold = envConfig.MULTI_MENTION_HIGH_SIMILARITY
    const lowSimilarityThreshold = envConfig.SIM_LOW_THRESHOLD

    const highMentions = uniqueCandidates.filter((c) => c.score >= highSimilarityThreshold)
    const mediumMentions = uniqueCandidates.filter(
      (c) => c.score >= lowSimilarityThreshold && c.score < highSimilarityThreshold
    )
    const multiMentionThreshold = envConfig.MULTI_MENTION_THRESHOLD
    let multiMentionBoost = false

    // TASK 4: Rule-level decision
    // Use SimilarityContract for conservative aggregation and section upgrades
    const bands = chunkEvidence
      .map((e) => e.bandStatus as SimilarityBand)
      .filter((b): b is SimilarityBand => !!b)

    let ruleStatus = aggregateRuleResult(bands)
    let matchStatus: MatchStatusType = ruleStatus === 'FULL' ? 'FULL' : ruleStatus === 'PARTIAL' ? 'PARTIAL' : ruleStatus === 'NONE' ? 'NONE' : 'NO_EVIDENCE'

    // Apply multi-mention boost rules (override aggregateRuleResult if applicable)
    if (highMentions.length >= multiMentionThreshold) {
      // 3+ high mentions -> AUTO FULL match
      matchStatus = 'FULL'
      multiMentionBoost = true
    } else if (mediumMentions.length >= multiMentionThreshold) {
      // 3+ medium mentions -> Upgrade to FULL (strong evidence across CV)
      if (matchStatus !== 'FULL') {
        matchStatus = 'FULL'
        multiMentionBoost = true
      }
    }

    let sectionUpgradeApplied = false
    let upgradeFromSection: string | undefined

    if (matchStatus === 'PARTIAL' && bestOverallMatch && !multiMentionBoost) {
      const confirmedByJudge = chunkEvidence.every(e => {
        if (e.bandStatus === 'AMBIGUOUS' && e.bestCandidate?.cvChunkId === bestOverallMatch.cvChunkId) {
          return !e.judgeUsed || (e.judgeResult?.relevant ?? true)
        }
        return true
      })

      if (confirmedByJudge && canUpgradePartialToFull(
        { sectionType: bestOverallMatch.sectionType as any, similarity: bestOverallMatch.score },
        chunkEvidence.filter(e => e.bandStatus && e.bandStatus !== 'NO_EVIDENCE').length,
        thresholds
      )) {
        matchStatus = 'FULL'
        sectionUpgradeApplied = true
        upgradeFromSection = bestOverallMatch.sectionType
      }
    }

    // TASK 3: LLM judge degradation rule (PARTIAL -> NONE if judge says NOT RELEVANT)
    if (matchStatus === 'PARTIAL' && !sectionUpgradeApplied) {
      const judgedNotRelevant = chunkEvidence.some(
        (e) => e.bandStatus === 'AMBIGUOUS' && e.judgeUsed && e.judgeResult && !e.judgeResult.relevant,
      )

      if (judgedNotRelevant) {
        matchStatus = 'NONE'
      }
    }

    // Calculate scores
    const score = MATCH_STATUS_SCORES[matchStatus]
    const multiplier = RULE_TYPE_MULTIPLIERS[rule.ruleType as keyof typeof RULE_TYPE_MULTIPLIERS] || 1.0
    const weightedScore = score * multiplier

    const traceEntry: MatchTraceEntryDTO = {
      ruleId: rule.id,
      ruleType: rule.ruleType as RuleCategoryType,
      ruleContent: rule.content,
      chunkEvidence,
      matchStatus,
      bestChunkMatch: bestOverallMatch
        ? {
          ruleChunkId: bestOverallMatch.ruleChunkId,
          cvChunkId: bestOverallMatch.cvChunkId,
          sectionType: bestOverallMatch.sectionType,
          score: bestOverallMatch.score,
          band: bestOverallMatch.band,
        }
        : null,
      sectionUpgradeApplied,
      upgradeFromSection,
      multiMentionCount: uniqueCandidates.length,
      multiMentionBoost,
      mentionDetails: {
        high: highMentions.length,
        medium: mediumMentions.length,
        low: uniqueCandidates.length - highMentions.length - mediumMentions.length,
      },
      score,
      weightedScore,
      satisfied: matchStatus !== 'NONE',
    }

    // TASK 6/8: Strict gap detection using Official Severity Mapping
    let gap: GapDTO | null = null
    if (matchStatus !== 'FULL') {
      const bestBand = (bestOverallMatch?.band ?? 'NO_EVIDENCE') as SimilarityBand
      const severity = getGapSeverity(bestBand, rule.ruleType as any)

      if (severity !== 'NONE' && (matchStatus === 'NONE' || matchStatus === 'NO_EVIDENCE' || (matchStatus === 'PARTIAL' && rule.ruleType === 'MUST_HAVE'))) {
        const bestChunk = rule.chunks[0]
        gap = {
          gapId: `GAP-${rule.id.slice(0, 8)}`,
          ruleId: rule.id,
          ruleKey: rule.id,
          ruleChunkId: bestChunk?.id ?? rule.id,
          ruleChunkContent: bestChunk?.content ?? rule.content,
          ruleType: rule.ruleType as RuleCategoryType,
          bestCvChunkId: bestOverallMatch?.cvChunkId ?? null,
          bestCvChunkSnippet: bestOverallMatch?.content ? bestOverallMatch.content.slice(0, 100) : null,
          sectionType: bestOverallMatch?.sectionType ?? null,
          similarity: bestOverallMatch?.score ?? null,
          band: bestBand,
          severity: severity as GapSeverityType,
          reason: bestOverallMatch
            ? `Best match score (${bestOverallMatch.score.toFixed(2)}) in ${bestOverallMatch.band} band - severity: ${severity}`
            : 'No matching CV content found above similarity floor',
        }
      }
    }

    // TASK 7: AMBIGUOUS-aware suggestions
    let suggestion: SuggestionDTO | null = null
    if (matchStatus !== 'FULL') {
      suggestion = this.generateSuggestion(rule, matchStatus, bestOverallMatch, suggestionIndex)
    }

    return { traceEntry, gap, suggestion }
  }

  private classifyBand(
    score: number,
    config: { simFloor: number; simLowThreshold: number; simHighThreshold: number },
  ): string {
    if (score >= config.simHighThreshold) return 'HIGH'
    if (score >= config.simLowThreshold) return 'AMBIGUOUS'
    return 'LOW'
  }

  /**
   * Generate suggestions using concept labels (no keyword templates)
   * - PARTIAL (AMBIGUOUS): Suggest EXPAND/CLARIFY existing content
   * - NONE/NO_EVIDENCE: Suggest ADD new content
   *
   * Suggestions are based on semantic concept labels extracted from rule content,
   * NOT hardcoded keyword templates.
   */
  private generateSuggestion(
    rule: { id: string; ruleType: string; content: string; chunks?: Array<{ id: string; content: string }> },
    matchStatus: MatchStatusType,
    bestMatch: { cvChunkId: string; sectionType: string; content?: string; score?: number } | null,
    existingCount: number,
  ): SuggestionDTO {
    const target = this.inferSuggestionTarget(rule.content)
    const isPartial = matchStatus === 'PARTIAL'
    const suggestionType = isPartial ? SUGGESTION_ACTION_TYPES.PARTIAL : SUGGESTION_ACTION_TYPES.MISSING
    const type = isPartial ? 'PARTIAL' : 'MISSING'

    const conceptLabel = this.extractConceptLabel(rule.content)
    const bestChunk = rule.chunks?.[0]

    // Generate message using concept label (no hardcoded templates)
    const message = isPartial
      ? `Expand your existing content to better demonstrate: ${conceptLabel}`
      : `Consider adding content that shows: ${conceptLabel}`

    // Determine severity based on rule type and match status
    const severity =
      rule.ruleType === 'MUST_HAVE'
        ? matchStatus === 'NONE' || matchStatus === 'NO_EVIDENCE'
          ? 'MAJOR_GAP'
          : 'IMPROVEMENT'
        : 'MINOR_GAP'

    return {
      suggestionId: `SUG-${(existingCount + 1).toString().padStart(4, '0')}`,
      ruleId: rule.id,
      ruleKey: rule.id,
      ruleChunkId: bestChunk?.id ?? rule.id,
      severity: severity as 'CRITICAL_SKILL_GAP' | 'MAJOR_GAP' | 'MINOR_GAP' | 'IMPROVEMENT' | 'NO_GAP',
      type,
      message,
      targetCvChunkId: bestMatch?.cvChunkId ?? null,
      sectionType: bestMatch?.sectionType ?? this.mapTargetToSectionType(target),
      evidenceSnippet: bestMatch?.content ? bestMatch.content.slice(0, 100) : null,
      suggestedActionType: suggestionType as 'ADD_BULLET' | 'EXPAND_BULLET' | 'ADD_METRIC' | 'ADD_LINK',
      conceptLabel,
    }
  }

  /**
   * Extract concept label from rule content (short keyword extraction)
   */
  private extractConceptLabel(content: string): string {
    // If content is short, use it directly
    if (content.length <= 50) return content.trim()

    // Extract key phrases (simplified)
    const stopwords = new Set([
      'a',
      'an',
      'the',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'of',
      'in',
      'to',
      'for',
      'with',
      'on',
      'at',
      'by',
      'from',
      'as',
      'and',
      'or',
      'but',
      'have',
      'has',
      'had',
    ])
    const tokens = content
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !stopwords.has(t))
      .slice(0, 5)

    return tokens.length > 0 ? tokens.join(', ') : content.slice(0, 50)
  }

  /**
   * Map suggestion target to section type
   */
  private mapTargetToSectionType(target: 'cv' | 'project' | 'skills' | 'experience' | 'education'): string | null {
    switch (target) {
      case 'project':
        return 'PROJECTS'
      case 'skills':
        return 'SKILLS'
      case 'experience':
        return 'EXPERIENCE'
      case 'education':
        return 'EDUCATION'
      default:
        return null
    }
  }

  private truncateContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) return content
    return content.substring(0, maxLength - 3) + '...'
  }

  private inferSuggestionTarget(content: string): 'cv' | 'project' | 'skills' | 'experience' | 'education' {
    const lowerContent = content.toLowerCase()
    if (lowerContent.includes('project') || lowerContent.includes('portfolio')) {
      return 'project'
    }
    if (lowerContent.includes('skill') || lowerContent.includes('proficient')) {
      return 'skills'
    }
    if (lowerContent.includes('experience') || lowerContent.includes('work')) {
      return 'experience'
    }
    if (lowerContent.includes('degree') || lowerContent.includes('education')) {
      return 'education'
    }
    return 'cv'
  }

  /**
   * Calculate overall match level using weighted scores
   * TASK 5: AMBIGUOUS-aware scoring
   */
  private calculateMatchLevel(
    matchTrace: MatchTraceEntryDTO[],
    jdRules: Array<{ id: string; ruleType: string }>,
  ): JdMatchLevelType {
    if (matchTrace.length === 0) return 'LOW_MATCH'

    // Calculate weighted score rate
    const totalWeightedScore = matchTrace.reduce((sum, t) => sum + t.weightedScore, 0)
    const maxPossibleWeightedScore = matchTrace.reduce((sum, t) => {
      const multiplier = RULE_TYPE_MULTIPLIERS[t.ruleType as keyof typeof RULE_TYPE_MULTIPLIERS] || 1.0
      return sum + MATCH_STATUS_SCORES.FULL * multiplier
    }, 0)
    const weightedScoreRate = maxPossibleWeightedScore > 0 ? totalWeightedScore / maxPossibleWeightedScore : 0

    // Calculate MUST_HAVE score rate
    const mustHaveTraces = matchTrace.filter((t) => t.ruleType === 'MUST_HAVE')
    const mustHaveScore = mustHaveTraces.reduce((sum, t) => sum + t.score, 0)
    const maxMustHaveScore = mustHaveTraces.length * MATCH_STATUS_SCORES.FULL
    const mustHaveScoreRate = maxMustHaveScore > 0 ? mustHaveScore / maxMustHaveScore : 1

    // Determine level based on thresholds
    if (
      weightedScoreRate >= MATCH_LEVEL_THRESHOLDS.STRONG_MATCH.weightedScoreRate &&
      mustHaveScoreRate >= MATCH_LEVEL_THRESHOLDS.STRONG_MATCH.mustHaveScoreRate
    ) {
      return 'STRONG_MATCH'
    }

    if (
      weightedScoreRate >= MATCH_LEVEL_THRESHOLDS.GOOD_MATCH.weightedScoreRate &&
      mustHaveScoreRate >= MATCH_LEVEL_THRESHOLDS.GOOD_MATCH.mustHaveScoreRate
    ) {
      return 'GOOD_MATCH'
    }

    if (
      weightedScoreRate >= MATCH_LEVEL_THRESHOLDS.PARTIAL_MATCH.weightedScoreRate &&
      mustHaveScoreRate >= MATCH_LEVEL_THRESHOLDS.PARTIAL_MATCH.mustHaveScoreRate
    ) {
      return 'PARTIAL_MATCH'
    }

    return 'LOW_MATCH'
  }

  /**
   * Calculate detailed scores using weighted scoring
   * TASK 5: AMBIGUOUS-aware scoring
   */
  private calculateScores(
    matchTrace: MatchTraceEntryDTO[],
    jdRules: Array<{ id: string; ruleType: string }>,
  ): { mustHaveScore: number; niceToHaveScore: number; bestPracticeScore: number; totalScore: number } {
    const calculateCoverage = (ruleType: string) => {
      const traces = matchTrace.filter((t) => t.ruleType === ruleType)
      if (traces.length === 0) return 100

      // Use weighted scores for coverage
      const totalScore = traces.reduce((sum, t) => sum + t.score, 0)
      const maxScore = traces.length * MATCH_STATUS_SCORES.FULL
      return (totalScore / maxScore) * 100
    }

    const mustHaveScore = calculateCoverage('MUST_HAVE')
    const niceToHaveScore = calculateCoverage('NICE_TO_HAVE')
    const bestPracticeScore = calculateCoverage('BEST_PRACTICE')

    // Weighted total score
    const totalScore =
      mustHaveScore * RULE_TYPE_WEIGHTS.MUST_HAVE +
      niceToHaveScore * RULE_TYPE_WEIGHTS.NICE_TO_HAVE +
      bestPracticeScore * RULE_TYPE_WEIGHTS.BEST_PRACTICE

    return {
      mustHaveScore: Math.round(mustHaveScore * 100) / 100,
      niceToHaveScore: Math.round(niceToHaveScore * 100) / 100,
      bestPracticeScore: Math.round(bestPracticeScore * 100) / 100,
      totalScore: Math.round(totalScore * 100) / 100,
    }
  }
}
