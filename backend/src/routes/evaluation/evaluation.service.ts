import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { EvaluationRepo } from './evaluation.repo'
import { CvService } from '../cv/cv.service'
import { JdService } from '../jd/jd.service'
import { CvQualityEngine } from 'src/engines/cv-quality/cv-quality.engine'
import { JdMatchingEngine } from 'src/engines/jd-matching/jd-matching.engine'
import { EmbeddingService } from 'src/shared/services/embedding.service'
import type { CvQualityResultDTO, JdMatchResultDTO, TraceMetadataDTO, GapDTO, SuggestionDTO } from './evaluation.dto'
import envConfig from 'src/shared/config'

/**
 * EvaluationService is a PURE ORCHESTRATOR.
 *
 * Allowed:
 * - Ownership checks (CV/JD belongs to user)
 * - Pipeline status checks (Cv.status)
 * - Readiness gate (only NOT_READY blocks pipeline; NEEDS_IMPROVEMENT still gets JD matching)
 * - DTO assembly
 *
 * Forbidden:
 * - Similarity computations
 * - Threshold/band application
 * - Rule evaluation
 * - Scoring
 */
@Injectable()
export class EvaluationService {
  constructor(
    private readonly cvService: CvService,
    private readonly jdService: JdService,
    private readonly cvQualityEngine: CvQualityEngine,
    private readonly jdMatchingEngine: JdMatchingEngine,
    private readonly embeddingService: EmbeddingService,
    private readonly evaluationRepo: EvaluationRepo,
  ) { }

  async runEvaluation(userId: string, cvId: string, jdId?: string) {
    const startTime = Date.now()
    const requestId = randomUUID()
    const timings: Record<string, number> = {}

    // Stage 6: Pipeline Gating
    // Guard: Ensure CV exists and is parsed
    await this.cvService.ensureCvParsed(userId, cvId)

    // Stage 5: CV Quality Evaluation (STRUCTURAL only, cheap gate)
    const cvQualityStart = Date.now()
    const cvQualityStructural = await this.cvQualityEngine.evaluate(cvId, { includeSemantic: false })
    timings.cvQuality = Date.now() - cvQualityStart

    // Hard gate: If NOT_READY, return immediately
    if (cvQualityStructural.decision === 'NOT_READY') {
      return this.buildResponse(cvQualityStructural, undefined, [], [], {
        requestId,
        cvId,
        jdId,
        timings,
        startTime,
      })
    }

    // Stage 7: Embed CV chunks
    const cvEmbeddingStart = Date.now()
    await this.embeddingService.embedCvChunks(cvId)
    timings.cvEmbedding = Date.now() - cvEmbeddingStart

    // Stage 8: CV Quality Evaluation (STRUCTURAL + SEMANTIC via RuleSet in DB)
    const cvQualityFullStart = Date.now()
    const cvQualityResult = await this.cvQualityEngine.evaluate(cvId, {
      includeSemantic: true,
      semanticRuleSetKey: 'cv-quality-student-fresher',
    })
    timings.cvQuality = (timings.cvQuality ?? 0) + (Date.now() - cvQualityFullStart)

    // Hard gate (post-semantic): If NOT_READY, stop before JD matching
    if (cvQualityResult.decision === 'NOT_READY') {
      return this.buildResponse(cvQualityResult, undefined, [], [], {
        requestId,
        cvId,
        jdId,
        timings,
        startTime,
      })
    }

    // Gate: If no JD provided, return quality-only
    if (!jdId) {
      return this.buildResponse(cvQualityResult, undefined, [], [], {
        requestId,
        cvId,
        jdId: undefined,
        timings,
        startTime,
      })
    }

    // JD matching runs for both READY and NEEDS_IMPROVEMENT (only NOT_READY is gated above)

    // Guard: Ensure JD exists and belongs to user
    await this.jdService.ensureJdExists(userId, jdId)

    // Stage 11: Embed JD rule chunks
    const jdEmbeddingStart = Date.now()
    await this.embeddingService.embedJdRuleChunks(jdId)
    timings.jdEmbedding = Date.now() - jdEmbeddingStart

    // Stage 12-17: JD Matching Engine
    const jdMatchingStart = Date.now()
    const jdMatchResult = await this.jdMatchingEngine.evaluate(cvId, jdId, {
      topK: envConfig.MATCH_TOP_K,
      simFloor: envConfig.SIM_FLOOR,
      simLowThreshold: envConfig.SIM_LOW_THRESHOLD,
      simHighThreshold: envConfig.SIM_HIGH_THRESHOLD,
      llmJudgeEnabled: envConfig.LLM_JUDGE_ENABLED,
    })
    timings.jdMatching = Date.now() - jdMatchingStart

    // Stage 20: Final DTO Assembly
    const result = this.buildResponse(cvQualityResult, jdMatchResult, jdMatchResult.gaps, jdMatchResult.suggestions, {
      requestId,
      cvId,
      jdId,
      timings,
      startTime,
    })

    // Stage 21: Persist Evaluation
    await this.evaluationRepo.createEvaluation(userId, cvId, jdId, result)

    return result
  }

  private buildResponse(
    cvQualityResult: CvQualityResultDTO,
    jdMatchResult: JdMatchResultDTO | undefined,
    gaps: GapDTO[],
    suggestions: SuggestionDTO[],
    context: {
      requestId: string
      cvId: string
      jdId?: string
      timings: Record<string, number>
      startTime: number
    },
  ) {
    const trace: TraceMetadataDTO = {
      requestId: context.requestId,
      cvId: context.cvId,
      jdId: context.jdId,
      ruleSetVersion: cvQualityResult.ruleSetVersion,
      timingsMs: {
        total: Date.now() - context.startTime,
      },
    }

    // Build decision support
    const criticalGaps = gaps.filter((g) => g.severity === 'CRITICAL_SKILL_GAP').length
    const majorGaps = gaps.filter((g) => g.severity === 'MAJOR_GAP').length
    const improvementAreas = gaps.filter((g) => g.severity === 'IMPROVEMENT').length

    let readinessScore = 100
    readinessScore -= criticalGaps * 25
    readinessScore -= majorGaps * 10
    readinessScore -= improvementAreas * 2
    readinessScore = Math.max(0, Math.min(100, readinessScore))

    let recommendation: 'NOT_READY' | 'NEEDS_IMPROVEMENT' | 'READY_TO_APPLY'
    if (cvQualityResult.decision === 'NOT_READY' || criticalGaps > 0) {
      recommendation = 'NOT_READY'
    } else if (cvQualityResult.decision === 'NEEDS_IMPROVEMENT' || majorGaps > 2) {
      recommendation = 'NEEDS_IMPROVEMENT'
    } else {
      recommendation = 'READY_TO_APPLY'
    }

    return {
      cvQuality: cvQualityResult,
      jdMatch: jdMatchResult
        ? {
          ...jdMatchResult,
          matchTrace: jdMatchResult.matchTrace.map((entry) => ({
            ...entry,
            // Strip verbose candidate lists, keep judgeResult and metadata
            chunkEvidence: entry.chunkEvidence.map((ce) => ({
              ...ce,
              candidates: [], // Strip detailed candidates list
            })),
          })),
        }
        : null,
      gaps,
      suggestions,
      decisionSupport: {
        readinessScore,
        recommendation,
        explanation: {
          criticalMustHaveGaps: criticalGaps,
          majorGaps,
          improvementAreas,
        },
      },
      trace,
    }
  }

  async listEvaluations(userId: string) {
    const evaluations = await this.evaluationRepo.findEvaluationsByUserId(userId)

    return {
      evaluations: evaluations.map((evaluation) => ({
        id: evaluation.id,
        cvId: evaluation.cvId,
        jdId: evaluation.jdId,
        results: evaluation.results,
        createdAt: evaluation.createdAt,
        cv: evaluation.cv,
        jd: evaluation.jd,
      })),
    }
  }

  /**
   * Get evaluation summary (lightweight for FE)
   */
  async getEvaluationSummary(userId: string, evaluationId: string) {
    // Fetch evaluation from DB
    const evaluation = await this.evaluationRepo.findById(evaluationId)

    if (!evaluation) {
      throw new Error('Evaluation not found')
    }

    // Verify ownership
    const cv = await this.cvService.getCvById(userId, evaluation.cvId)
    if (!cv) {
      throw new Error('Not authorized')
    }

    // Parse stored result
    const result = JSON.parse(evaluation.results as string)

    // Build summary
    return {
      evaluationId: evaluation.id,
      cvId: evaluation.cvId,
      jdId: evaluation.jdId || '',
      scores: result.jdMatch?.scores || {
        mustHaveScore: 0,
        niceToHaveScore: 0,
        bestPracticeScore: 0,
        totalScore: 0,
      },
      matchLevel: result.jdMatch?.level || 'LOW_MATCH',
      ruleSummary: this.buildRuleSummary(result.jdMatch?.matchTrace || []),
      gaps: (result.jdMatch?.gaps || []).map((g: any) => ({
        ruleContent: g.ruleChunkContent,
        severity: g.severity,
        reason: g.reason,
      })),
      suggestions: (result.jdMatch?.suggestions || []).map((s: any) => ({
        message: s.message,
        severity: s.severity,
        actionType: s.suggestedActionType,
        targetSection: s.sectionType,
      })),
    }
  }

  /**
   * Delete evaluation
   */
  async deleteEvaluation(userId: string, evaluationId: string): Promise<void> {
    // Fetch evaluation
    const evaluation = await this.evaluationRepo.findById(evaluationId)

    if (!evaluation) {
      throw new Error('Evaluation not found')
    }

    // Verify ownership
    const cv = await this.cvService.getCvById(userId, evaluation.cvId)
    if (!cv) {
      throw new Error('Not authorized')
    }

    // Delete
    await this.evaluationRepo.deleteById(evaluationId)
  }

  /**
   * Build rule summary counts
   */
  private buildRuleSummary(matchTrace: any[]) {
    const summary = {
      mustHave: { total: 0, satisfied: 0, partial: 0, missing: 0 },
      niceToHave: { total: 0, satisfied: 0, partial: 0, missing: 0 },
      bestPractice: { total: 0, satisfied: 0, partial: 0, missing: 0 },
    }

    for (const trace of matchTrace) {
      const category =
        trace.ruleType === 'MUST_HAVE'
          ? 'mustHave'
          : trace.ruleType === 'NICE_TO_HAVE'
            ? 'niceToHave'
            : 'bestPractice'

      summary[category].total++

      if (trace.matchStatus === 'FULL') {
        summary[category].satisfied++
      } else if (trace.matchStatus === 'PARTIAL') {
        summary[category].partial++
      } else {
        summary[category].missing++
      }
    }

    return summary
  }
}
