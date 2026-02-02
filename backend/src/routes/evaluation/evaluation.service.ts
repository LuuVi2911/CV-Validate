import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { CvService } from '../cv/cv.service'
import { JdService } from '../jd/jd.service'
import { CvQualityEngine } from 'src/engines/cv-quality/cv-quality.engine'
import { JdMatchingEngine } from 'src/engines/jd-matching/jd-matching.engine'
import { EmbeddingService } from 'src/shared/services/embedding.service'
import type { CvQualityResultDTO, JdMatchResultDTO, TraceMetadataDTO } from './evaluation.dto'
import envConfig from 'src/shared/config'

/**
 * EvaluationService is a PURE ORCHESTRATOR.
 *
 * Allowed:
 * - Ownership checks (CV/JD belongs to user)
 * - Pipeline status checks (Cv.status)
 * - Readiness gate (if cvDecision !== READY)
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

    // Gate: If CV decision is not READY, return quality-only (JD matching requires READY)
    if (cvQualityResult.decision !== 'READY') {
      return this.buildResponse(cvQualityResult, undefined, {
        requestId,
        cvId,
        jdId,
        stopReason: 'CV needs improvement; JD matching requires READY status',
        timings,
        startTime,
      })
    }

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

    return {
      cvQuality: cvQualityResult,
      jdMatch: jdMatchResult,
      trace,
    }
  }
}
