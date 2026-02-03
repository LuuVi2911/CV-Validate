import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
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
  ) {}

  async runEvaluation(userId: string, cvId: string, jdId?: string) {
    const startTime = Date.now()
    const requestId = randomUUID()
    const timings: Record<string, number> = {}

    // Stage 6: Pipeline Gating
    // Guard: Ensure CV exists and is parsed
    await this.cvService.ensureCvParsed(userId, cvId)

    // Stage 5: CV Quality Evaluation
    const cvQualityStart = Date.now()
    const cvQualityResult = await this.cvQualityEngine.evaluate(cvId)
    timings.cvQuality = Date.now() - cvQualityStart

    // Hard gate: If NOT_READY, return immediately
    if (cvQualityResult.decision === 'NOT_READY') {
      return this.buildResponse(cvQualityResult, undefined, {
        requestId,
        cvId,
        jdId,
        stopReason: 'CV quality is NOT_READY due to MUST_HAVE violations',
        timings,
        startTime,
      })
    }

    // Stage 7: Embed CV chunks
    const cvEmbeddingStart = Date.now()
    await this.embeddingService.embedCvChunks(cvId)
    timings.cvEmbedding = Date.now() - cvEmbeddingStart

    // Gate: If no JD provided, return quality-only
    if (!jdId) {
      return this.buildResponse(cvQualityResult, undefined, {
        requestId,
        cvId,
        jdId: undefined,
        stopReason: 'No JD provided',
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

    // Stage 18: Final DTO Assembly
    return this.buildResponse(cvQualityResult, jdMatchResult, {
      requestId,
      cvId,
      jdId,
      stopReason: undefined,
      timings,
      startTime,
    })
  }

  private buildResponse(
    cvQualityResult: CvQualityResultDTO,
    jdMatchResult: JdMatchResultDTO | undefined,
    context: {
      requestId: string
      cvId: string
      jdId?: string
      stopReason?: string
      timings: Record<string, number>
      startTime: number
    },
  ) {
    const trace: TraceMetadataDTO = {
      requestId: context.requestId,
      cvId: context.cvId,
      jdId: context.jdId,
      stopReason: context.stopReason,
      ruleSetVersion: cvQualityResult.ruleSetVersion,
      embedding: {
        provider: 'gemini',
        model: envConfig.EMBEDDING_MODEL,
        dimension: envConfig.EMBEDDING_DIM,
      },
      matching: {
        topK: envConfig.MATCH_TOP_K,
        thresholds: {
          floor: envConfig.SIM_FLOOR,
          low: envConfig.SIM_LOW_THRESHOLD,
          high: envConfig.SIM_HIGH_THRESHOLD,
        },
      },
      timingsMs: {
        cvQuality: context.timings.cvQuality,
        cvEmbedding: context.timings.cvEmbedding,
        jdEmbedding: context.timings.jdEmbedding,
        jdMatching: context.timings.jdMatching,
        total: Date.now() - context.startTime,
      },
    }

    // Extract gaps and suggestions from jdMatchResult
    const gaps: GapDTO[] = jdMatchResult?.gaps ?? []
    const suggestions: SuggestionDTO[] = jdMatchResult?.suggestions ?? []

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
      jdMatch: jdMatchResult ?? null,
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
}
