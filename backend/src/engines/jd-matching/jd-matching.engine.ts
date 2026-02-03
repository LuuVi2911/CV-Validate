import { Injectable } from '@nestjs/common'
import { CvRepo } from 'src/routes/cv/cv.repo'
import { JdRepo } from 'src/routes/jd/jd.repo'
import { VectorSearchService, type VectorMatchCandidate } from 'src/shared/services/vector-search.service'
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
    private readonly vectorSearchService: VectorSearchService,
    private readonly geminiJudgeService: GeminiJudgeService,
  ) {}

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

    // Collect all rule chunk IDs for batch matching
    const allRuleChunkIds: string[] = []
    for (const rule of jdRules) {
      for (const chunk of rule.chunks) {
        allRuleChunkIds.push(chunk.id)
      }
    }

    // Stage 12: Batch vector matching for all rule chunks
    const matchResults = await this.vectorSearchService.findTopKMatchesBatch(allRuleChunkIds, cvId, config.topK)

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
          band: this.classifyBand(c.score, config) as SimilarityBandType,
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

    // TASK 4: Rule-level decision
    // A rule is: FULL if any chunk yields FULL, PARTIAL if no FULL but at least one PARTIAL, NONE otherwise
    let matchStatus: MatchStatusType = 'NONE'
    let sectionUpgradeApplied = false
    let upgradeFromSection: string | undefined

    const hasFullChunk = chunkEvidence.some((e) => e.bandStatus === 'HIGH')
    const hasPartialChunk = chunkEvidence.some((e) => e.bandStatus === 'AMBIGUOUS')

    if (hasFullChunk) {
      matchStatus = 'FULL'
    } else if (hasPartialChunk) {
      // TASK 1: AMBIGUOUS → PARTIAL (never NONE)
      matchStatus = 'PARTIAL'

      // TASK 2: Section-aware upgrade for PROJECTS/EXPERIENCE
      if (bestOverallMatch && UPGRADE_ELIGIBLE_SECTIONS.includes(bestOverallMatch.sectionType as any)) {
        // Check if judge confirmed relevance (if used)
        const relevantEvidence = chunkEvidence.find(
          (e) =>
            e.bestCandidate?.cvChunkId === bestOverallMatch?.cvChunkId &&
            e.bandStatus === 'AMBIGUOUS' &&
            (!e.judgeUsed || (e.judgeResult?.relevant ?? true)), // Allow upgrade if judge not used or judge says relevant
        )

        if (relevantEvidence) {
          matchStatus = 'FULL'
          sectionUpgradeApplied = true
          upgradeFromSection = bestOverallMatch.sectionType
        }
      }
    }

    // TASK 3: LLM judge degradation rule
    // If judge was used and said NOT relevant, we can downgrade PARTIAL → NONE
    // But ONLY if judge explicitly said not relevant (not if judge was skipped/unavailable)
    if (matchStatus === 'PARTIAL' && !sectionUpgradeApplied) {
      const judgedNotRelevant = chunkEvidence.some(
        (e) => e.bandStatus === 'AMBIGUOUS' && e.judgeUsed && e.judgeResult && !e.judgeResult.relevant,
      )

      if (judgedNotRelevant) {
        // Judge explicitly said not relevant - downgrade to NONE
        matchStatus = 'NONE'
      }
      // If judge was skipped/unavailable, AMBIGUOUS stays PARTIAL (NEVER degrades)
    }

    // Calculate scores (TASK 5)
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
      score,
      weightedScore,
      satisfied: matchStatus !== 'NONE', // Legacy compatibility
    }

    // TASK 6: Strict gap detection
    let gap: GapDTO | null = null
    if (
      matchStatus === 'NONE' &&
      GAP_ELIGIBLE_RULE_TYPES.includes(rule.ruleType as (typeof GAP_ELIGIBLE_RULE_TYPES)[number])
    ) {
      const bestChunk = rule.chunks[0] // Get first chunk for reference
      const severity =
        rule.ruleType === 'MUST_HAVE'
          ? bestOverallMatch && bestOverallMatch.score >= 0.3
            ? 'MAJOR_GAP'
            : 'CRITICAL_SKILL_GAP'
          : 'MINOR_GAP'

      gap = {
        gapId: `GAP-${rule.id.slice(0, 8)}`,
        ruleId: rule.id,
        ruleKey: rule.id, // JD rules use id as key
        ruleChunkId: bestChunk?.id ?? rule.id,
        ruleChunkContent: bestChunk?.content ?? rule.content,
        ruleType: rule.ruleType as RuleCategoryType,
        bestCvChunkId: bestOverallMatch?.cvChunkId ?? null,
        bestCvChunkSnippet: bestOverallMatch?.content ? bestOverallMatch.content.slice(0, 100) : null,
        sectionType: bestOverallMatch?.sectionType ?? null,
        similarity: bestOverallMatch?.score ?? null,
        band: (bestOverallMatch?.band ?? 'NO_EVIDENCE') as 'HIGH' | 'AMBIGUOUS' | 'LOW' | 'NO_EVIDENCE',
        severity: severity as GapSeverityType,
        reason: bestOverallMatch
          ? `Best match score (${bestOverallMatch.score.toFixed(2)}) in ${bestOverallMatch.band} band - insufficient evidence`
          : 'No matching CV content found above similarity floor',
      }
    }

    // TASK 7: AMBIGUOUS-aware suggestions
    let suggestion: SuggestionDTO | null = null
    if (matchStatus === 'PARTIAL' || matchStatus === 'NONE') {
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
  ): { mustCoverage: number; niceCoverage: number; bestCoverage: number; totalScore: number } {
    const calculateCoverage = (ruleType: string) => {
      const traces = matchTrace.filter((t) => t.ruleType === ruleType)
      if (traces.length === 0) return 100

      // Use weighted scores for coverage
      const totalScore = traces.reduce((sum, t) => sum + t.score, 0)
      const maxScore = traces.length * MATCH_STATUS_SCORES.FULL
      return (totalScore / maxScore) * 100
    }

    const mustCoverage = calculateCoverage('MUST_HAVE')
    const niceCoverage = calculateCoverage('NICE_TO_HAVE')
    const bestCoverage = calculateCoverage('BEST_PRACTICE')

    // Weighted total score
    const totalScore =
      mustCoverage * RULE_TYPE_WEIGHTS.MUST_HAVE +
      niceCoverage * RULE_TYPE_WEIGHTS.NICE_TO_HAVE +
      bestCoverage * RULE_TYPE_WEIGHTS.BEST_PRACTICE

    return {
      mustCoverage: Math.round(mustCoverage * 100) / 100,
      niceCoverage: Math.round(niceCoverage * 100) / 100,
      bestCoverage: Math.round(bestCoverage * 100) / 100,
      totalScore: Math.round(totalScore * 100) / 100,
    }
  }
}
