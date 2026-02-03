import { Injectable } from '@nestjs/common'
import type { RuleType } from 'src/generated/prisma/enums'
import { getGapSeverity, SimilarityBand } from './similarity/similarity.contract'
import type { RuleEvaluationResult, RuleChunkEvidence } from './semantic/semantic-evaluator'

/**
 * GAP DETECTOR
 *
 * Deterministic gap detection based on similarity bands and rule types.
 * Use SimilarityContract for the official severity mapping logic.
 */

// Use unified severity types from contract
export type GapSeverity =
  | 'CRITICAL_SKILL_GAP'
  | 'MAJOR_GAP'
  | 'MINOR_GAP'
  | 'PARTIAL_MATCH_ADVISORY'
  | 'ADVISORY'
  | 'NONE'

export interface Gap {
  gapId: string
  ruleId: string
  ruleKey: string
  ruleChunkId: string
  ruleChunkContent: string
  ruleType: RuleType
  bestCvChunkId: string | null
  bestCvChunkSnippet: string | null
  sectionType: string | null
  similarity: number | null
  band: SimilarityBand
  severity: GapSeverity
  reason: string
}

export interface GapDetectionResult {
  gaps: Gap[]
  summary: {
    total: number
    critical: number
    major: number
    minor: number
    advisory: number
    none: number
  }
}

@Injectable()
export class GapDetector {
  /**
   * Detect gaps from semantic evaluation results.
   */
  detectGaps(
    evaluationResults: RuleEvaluationResult[],
    ruleTypes: Map<string, RuleType>,
  ): GapDetectionResult {
    const gaps: Gap[] = []
    let gapCounter = 0

    for (const result of evaluationResults) {
      const ruleType = ruleTypes.get(result.ruleId) || 'NICE_TO_HAVE'

      for (const chunkEvidence of result.chunkEvidence) {
        const gap = this.detectGapForChunk(
          result.ruleId,
          result.ruleKey,
          chunkEvidence,
          ruleType,
          ++gapCounter,
        )

        if (gap.severity !== 'NONE') {
          gaps.push(gap)
        }
      }
    }

    return this.buildSummary(gaps)
  }

  private detectGapForChunk(
    ruleId: string,
    ruleKey: string,
    chunkEvidence: RuleChunkEvidence,
    ruleType: RuleType,
    gapCounter: number,
  ): Gap {
    const { ruleChunkId, ruleChunkContent, bestCandidate, bestBand } = chunkEvidence
    const similarity = bestCandidate?.similarity ?? null

    // Official severity mapping from contract
    const severity = getGapSeverity(bestBand, ruleType as any)
    const reason = this.generateReason(similarity, bestBand, ruleType, severity)

    return {
      gapId: `GAP-${gapCounter.toString().padStart(4, '0')}`,
      ruleId,
      ruleKey,
      ruleChunkId,
      ruleChunkContent,
      ruleType,
      bestCvChunkId: bestCandidate?.cvChunkId ?? null,
      bestCvChunkSnippet: bestCandidate?.snippet ?? null,
      sectionType: bestCandidate?.sectionType ?? null,
      similarity,
      band: bestBand,
      severity,
      reason,
    }
  }

  private generateReason(
    similarity: number | null,
    band: SimilarityBand,
    ruleType: RuleType,
    severity: GapSeverity,
  ): string {
    if (band === 'NO_EVIDENCE' || similarity === null) {
      return `No CV content found that matches this ${ruleType === 'MUST_HAVE' ? 'required' : 'recommended'} skill.`
    }

    if (severity === 'NONE') {
      return `Strong match found (similarity: ${(similarity * 100).toFixed(0)}%).`
    }

    return `Gap detected with severity: ${severity}. Best match similarity is ${(similarity * 100).toFixed(0)}% in ${band} band.`
  }

  private buildSummary(gaps: Gap[]): GapDetectionResult {
    const summary = {
      total: gaps.length,
      critical: gaps.filter((g) => g.severity === 'CRITICAL_SKILL_GAP').length,
      major: gaps.filter((g) => g.severity === 'MAJOR_GAP').length,
      minor: gaps.filter((g) => g.severity === 'MINOR_GAP').length,
      advisory: gaps.filter((g) => g.severity === 'ADVISORY' || g.severity === 'PARTIAL_MATCH_ADVISORY').length,
      none: gaps.filter((g) => g.severity === 'NONE').length,
    }

    return { gaps, summary }
  }
}
