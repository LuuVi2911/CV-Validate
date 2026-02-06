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
  ) {}

  async runEvaluation(userId: string, cvId: string, jdId?: string) {
    const startTime = Date.now()
    const requestId = randomUUID()
    const evaluationId = randomUUID()
    const timings: Record<string, number> = {}

    await this.cvService.ensureCvParsed(userId, cvId)

    //CV Quality Evaluation (STRUCTURAL only, cheap gate)
    const cvQualityStart = Date.now()
    const cvQualityStructural = await this.cvQualityEngine.evaluate(cvId, { includeSemantic: false })
    timings.cvQuality = Date.now() - cvQualityStart

    // Hard gate: If NOT_READY, return immediately
    if (cvQualityStructural.decision === 'NOT_READY') {
      const response = this.buildResponse(evaluationId, cvQualityStructural, undefined, [], [], {
        requestId,
        cvId,
        jdId,
        timings,
        startTime,
      })
      await this.evaluationRepo.createEvaluation(userId, cvId, jdId, response, evaluationId)
      return response
    }

    // Embed CV chunks
    const cvEmbeddingStart = Date.now()
    await this.embeddingService.embedCvChunks(cvId)
    timings.cvEmbedding = Date.now() - cvEmbeddingStart

    // CV Quality Evaluation (STRUCTURAL + SEMANTIC via RuleSet in DB)
    const cvQualityFullStart = Date.now()
    const cvQualityResult = await this.cvQualityEngine.evaluate(cvId, {
      includeSemantic: true,
      semanticRuleSetKey: 'cv-quality-student-fresher',
    })
    timings.cvQuality = (timings.cvQuality ?? 0) + (Date.now() - cvQualityFullStart)

    // Hard gate (post-semantic): If NOT_READY, stop before JD matching
    if (cvQualityResult.decision === 'NOT_READY') {
      const response = this.buildResponse(evaluationId, cvQualityResult, undefined, [], [], {
        requestId,
        cvId,
        jdId,
        timings,
        startTime,
      })
      await this.evaluationRepo.createEvaluation(userId, cvId, jdId, response, evaluationId)
      return response
    }

    // Gate: If no JD provided, return quality-only
    if (!jdId) {
      const response = this.buildResponse(evaluationId, cvQualityResult, undefined, [], [], {
        requestId,
        cvId,
        jdId: undefined,
        timings,
        startTime,
      })
      await this.evaluationRepo.createEvaluation(userId, cvId, undefined, response, evaluationId)
      return response
    }


    // Guard: Ensure JD exists and belongs to user
    await this.jdService.ensureJdExists(userId, jdId)

    // Embed JD rule chunks
    const jdEmbeddingStart = Date.now()
    await this.embeddingService.embedJdRuleChunks(jdId)
    timings.jdEmbedding = Date.now() - jdEmbeddingStart

    // JD Matching Engine
    const jdMatchingStart = Date.now()
    const jdMatchResult = await this.jdMatchingEngine.evaluate(cvId, jdId, {
      topK: envConfig.MATCH_TOP_K,
      simFloor: envConfig.SIM_FLOOR,
      simLowThreshold: envConfig.SIM_LOW_THRESHOLD,
      simHighThreshold: envConfig.SIM_HIGH_THRESHOLD,
      llmJudgeEnabled: envConfig.LLM_JUDGE_ENABLED,
    })
    timings.jdMatching = Date.now() - jdMatchingStart

    // Final DTO Assembly
    const result = this.buildResponse(
      evaluationId,
      cvQualityResult,
      jdMatchResult,
      jdMatchResult.gaps,
      jdMatchResult.suggestions,
      {
        requestId,
        cvId,
        jdId,
        timings,
        startTime,
      },
    )

    // Persist Evaluation
    await this.evaluationRepo.createEvaluation(userId, cvId, jdId, result, evaluationId)

    return result
  }

  private buildResponse(
    evaluationId: string,
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
      evaluationId,
      cvQuality: cvQualityResult,
      jdMatch: jdMatchResult
        ? {
            ...jdMatchResult,
            matchTrace: jdMatchResult.matchTrace.map((entry) => ({
              ...entry,
              chunkEvidence: entry.chunkEvidence.map((ce) => ({
                ...ce,
                candidates: [],
              })),
            })),
          }
        : null,
      mockQuestions: context.jdId ? [] : undefined,
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
    const evaluation = await this.evaluationRepo.findById(evaluationId)

    if (!evaluation) {
      throw new Error('Evaluation not found')
    }

    const cv = await this.cvService.getCvById(userId, evaluation.cvId)
    if (!cv) {
      throw new Error('Not authorized')
    }

    const result = evaluation.results as any
    const cvQuality = result.cvQuality as CvQualityResultDTO
    const jdMatch = result.jdMatch as JdMatchResultDTO | undefined
    const decisionSupport = result.decisionSupport

    const failedFindings = [
      ...cvQuality.mustHaveViolations
        .filter((f) => !f.passed)
        .map((f) => ({ category: 'MUST_HAVE', reason: f.reason })),
      ...cvQuality.niceToHaveFindings
        .filter((f) => !f.passed)
        .map((f) => ({ category: 'NICE_TO_HAVE', reason: f.reason })),
      ...cvQuality.bestPracticeFindings
        .filter((f) => !f.passed)
        .map((f) => ({ category: 'BEST_PRACTICE', reason: f.reason })),
    ]

    const matches =
      jdMatch?.matchTrace.map((entry: any) => ({
        ruleType: entry.ruleType,
        ruleContent: entry.ruleContent,
        judgeReason: entry.llmJudgeResult || entry.chunkEvidence?.[0]?.judgeResult?.reason || 'No detailed reason',
        score: entry.score,
        weightedScore: entry.weightedScore,
        satisfied: entry.satisfied,
        confidence: entry.chunkEvidence?.[0]?.judgeResult?.confidence?.toUpperCase() || 'MEDIUM',
      })) || []

      const gaps = (jdMatch?.gaps || []).map((g: any) => ({
      ruleChunkContent: g.ruleChunkContent,
      ruleType: g.ruleType,
      reason: g.reason,
    }))

    const suggestions = (jdMatch?.suggestions || []).map((s: any) => ({
      severity: s.severity,
      type: s.type,
      message: s.message,
      evidenceSnippet: s.evidenceSnippet || '',
      suggestedActionType: s.suggestedActionType,
      conceptLabel: s.conceptLabel,
      sectionType: s.sectionType || 'General',
    }))

    return {
      evaluationId: evaluation.id,
      cvId: evaluation.cvId,
      jdId: evaluation.jdId || '',
      cvQuality: {
        failedFindings,
      },
      jdMatch: {
        matches,
        scores: jdMatch?.scores || {
          mustHaveScore: 0,
          niceToHaveScore: 0,
          bestPracticeScore: 0,
          totalScore: 0,
        },
        level: jdMatch?.level || 'LOW_MATCH',
        gaps,
        suggestions,
      },
      decisionSupport,
    }
  }

  async deleteEvaluation(userId: string, evaluationId: string) {
    const evaluation = await this.evaluationRepo.findById(evaluationId)
    if (!evaluation) {
      throw new Error('Evaluation not found')
    }

    // Verify ownership
    const cv = await this.cvService.getCvById(userId, evaluation.cvId)
    if (!cv) {
      throw new Error('Not authorized')
    }

    await this.evaluationRepo.deleteById(evaluationId)
  }
}
