import { Injectable } from '@nestjs/common'
import { CvRepo } from 'src/routes/cv/cv.repo'
import { JdRepo } from 'src/routes/jd/jd.repo'
import { VectorSearchService, type VectorMatchCandidate } from 'src/shared/services/vector-search.service'
import { GeminiJudgeService } from 'src/shared/services/gemini-judge.service'
import type { JdMatchResultDTO, MatchTraceEntryDTO, GapDTO, SuggestionDTO } from 'src/routes/evaluation/evaluation.dto'
import type { JdMatchLevelType, SimilarityBandType, RuleCategoryType } from 'src/routes/evaluation/evaluation.model'
import { JD_MATCHING_RULE_SET_VERSION, SUGGESTION_TEMPLATES } from 'src/rules/student-fresher/jd-matching.rules'

/**
 * JD Matching Engine
 *
 * Responsibilities:
 * - Vector match JDRuleChunk ↔ CvChunk (cosine similarity)
 * - Similarity band classification: HIGH | AMBIGUOUS | LOW
 * - Optional Gemini judge only for AMBIGUOUS
 * - Deterministic gap detection + suggestion generation + JD match scoring
 *
 * Forbidden:
 * - Any CV quality logic
 * - Modifying CV quality decisions
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

    // Process each rule and its chunks
    for (const rule of jdRules) {
      for (const ruleChunk of rule.chunks) {
        // Get candidates for this rule chunk
        const candidates = matchResults.get(ruleChunk.id) || []

        // Stage 13: Band classification and floor filtering
        const bandedCandidates = candidates
          .filter((c) => c.score >= config.simFloor) // Apply floor
          .map((c) => ({
            cvChunkId: c.cvChunkId,
            sectionId: c.sectionId,
            sectionType: c.sectionType,
            score: c.score,
            band: this.classifyBand(c.score, config) as SimilarityBandType,
          }))

        // Select best candidate (already sorted by stable tie-break in VectorSearchService)
        const bestCandidate = bandedCandidates.length > 0 ? bandedCandidates[0] : null

        // Stage 14: Optional LLM judge for AMBIGUOUS
        let judgeUsed = false
        let judgeSkipped = false
        let judgeResult: { relevant: boolean; reason: string; confidence?: 'low' | 'medium' | 'high' } | null = null
        let satisfied = false

        if (bestCandidate) {
          if (bestCandidate.band === 'HIGH') {
            satisfied = true
          } else if (bestCandidate.band === 'AMBIGUOUS') {
            if (config.llmJudgeEnabled) {
              // Get the CV chunk content for the judge
              const cvChunkContent = candidates.find((c) => c.cvChunkId === bestCandidate.cvChunkId)?.content || ''

              // Call the Gemini judge
              const judgeResponse = await this.geminiJudgeService.judge({
                ruleChunkContent: ruleChunk.content,
                cvChunkContent,
                sectionType: bestCandidate.sectionType,
              })

              judgeUsed = judgeResponse.used
              judgeSkipped = judgeResponse.skipped
              judgeResult = judgeResponse.result

              // Satisfied if judge says relevant, otherwise not
              satisfied = judgeResponse.result?.relevant ?? false
            } else {
              judgeSkipped = true
              satisfied = false // Degrade to LOW when judge disabled
            }
          } else {
            // LOW band - not satisfied
            satisfied = false
          }
        }

        const traceEntry: MatchTraceEntryDTO = {
          ruleId: rule.id,
          ruleChunkId: ruleChunk.id,
          ruleChunkContent: ruleChunk.content,
          candidates: bandedCandidates,
          bestCandidate,
          judgeUsed,
          judgeSkipped,
          judgeResult,
          satisfied,
        }
        matchTrace.push(traceEntry)

        // Stage 15: Gap detection
        if (!satisfied) {
          gaps.push({
            jdId,
            ruleId: rule.id,
            ruleChunkId: ruleChunk.id,
            ruleType: rule.ruleType as RuleCategoryType,
            content: ruleChunk.content,
            reason: bestCandidate
              ? `Best match score (${bestCandidate.score.toFixed(2)}) in ${bestCandidate.band} band`
              : 'No matching CV content found above similarity floor',
          })
        }
      }
    }

    // Stage 16: Suggestion generation
    const suggestions = this.generateSuggestions(gaps)

    // Stage 17: JD Match Scoring
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

  private classifyBand(
    score: number,
    config: { simFloor: number; simLowThreshold: number; simHighThreshold: number },
  ): string {
    if (score < config.simFloor) return 'LOW'
    if (score >= config.simHighThreshold) return 'HIGH'
    if (score >= config.simLowThreshold) return 'AMBIGUOUS'
    return 'LOW'
  }

  private generateSuggestions(gaps: GapDTO[]): SuggestionDTO[] {
    return gaps.map((gap, index) => {
      const target = this.inferSuggestionTarget(gap.content)
      return {
        suggestionId: `suggestion-${index + 1}`,
        ruleId: gap.ruleId,
        ruleChunkId: gap.ruleChunkId,
        ruleType: gap.ruleType,
        message: this.generateSuggestionMessage(gap),
        target,
      }
    })
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

  private generateSuggestionMessage(gap: GapDTO): string {
    // Template-based suggestion generation using the templates from rules file
    const target = this.inferSuggestionTarget(gap.content)
    const templateKey = this.getTemplateKey(target)
    const templates = SUGGESTION_TEMPLATES[gap.ruleType]
    const template = templates[templateKey] || templates.default

    // Replace placeholder with actual content
    return template.replace('{content}', gap.content)
  }

  private getTemplateKey(
    target: 'cv' | 'project' | 'skills' | 'experience' | 'education',
  ): 'default' | 'skills' | 'experience' | 'project' {
    switch (target) {
      case 'skills':
        return 'skills'
      case 'experience':
        return 'experience'
      case 'project':
        return 'project'
      default:
        return 'default'
    }
  }

  private calculateMatchLevel(
    matchTrace: MatchTraceEntryDTO[],
    jdRules: Array<{ id: string; ruleType: string }>,
  ): JdMatchLevelType {
    if (matchTrace.length === 0) return 'LOW_MATCH'

    const satisfiedCount = matchTrace.filter((t) => t.satisfied).length
    const totalCount = matchTrace.length
    const satisfactionRate = satisfiedCount / totalCount

    // Check MUST_HAVE coverage
    const mustHaveRuleIds = new Set(jdRules.filter((r) => r.ruleType === 'MUST_HAVE').map((r) => r.id))
    const mustHaveTraces = matchTrace.filter((t) => mustHaveRuleIds.has(t.ruleId))
    const mustHaveSatisfied = mustHaveTraces.filter((t) => t.satisfied).length
    const mustHaveTotal = mustHaveTraces.length
    const mustHaveCoverage = mustHaveTotal > 0 ? mustHaveSatisfied / mustHaveTotal : 1

    // Scoring logic
    if (mustHaveCoverage < 0.5) return 'LOW_MATCH'
    if (satisfactionRate >= 0.85 && mustHaveCoverage >= 0.9) return 'STRONG_MATCH'
    if (satisfactionRate >= 0.65 && mustHaveCoverage >= 0.75) return 'GOOD_MATCH'
    if (satisfactionRate >= 0.4) return 'PARTIAL_MATCH'
    return 'LOW_MATCH'
  }

  private calculateScores(
    matchTrace: MatchTraceEntryDTO[],
    jdRules: Array<{ id: string; ruleType: string }>,
  ): { mustCoverage: number; niceCoverage: number; bestCoverage: number; totalScore: number } {
    const calculateCoverage = (ruleType: string) => {
      const ruleIds = new Set(jdRules.filter((r) => r.ruleType === ruleType).map((r) => r.id))
      const traces = matchTrace.filter((t) => ruleIds.has(t.ruleId))
      if (traces.length === 0) return 100
      const satisfied = traces.filter((t) => t.satisfied).length
      return (satisfied / traces.length) * 100
    }

    const mustCoverage = calculateCoverage('MUST_HAVE')
    const niceCoverage = calculateCoverage('NICE_TO_HAVE')
    const bestCoverage = calculateCoverage('BEST_PRACTICE')

    // Weighted score (MUST: 50%, NICE: 30%, BEST: 20%)
    const totalScore = mustCoverage * 0.5 + niceCoverage * 0.3 + bestCoverage * 0.2

    return {
      mustCoverage: Math.round(mustCoverage * 100) / 100,
      niceCoverage: Math.round(niceCoverage * 100) / 100,
      bestCoverage: Math.round(bestCoverage * 100) / 100,
      totalScore: Math.round(totalScore * 100) / 100,
    }
  }
}
