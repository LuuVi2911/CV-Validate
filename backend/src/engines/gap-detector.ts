import { Injectable } from '@nestjs/common'
import type { RuleType } from 'src/generated/prisma/enums'
import type { SimilarityBand, RuleLevelResult } from './similarity/similarity.contract'
import type { RuleEvaluationResult, RuleChunkEvidence } from './semantic/semantic-evaluator'

/**
 * GAP DETECTOR
 *
 * Deterministic gap detection based on similarity bands and rule types.
 *
 * Severity mapping (from plan):
 * - similarity >= 0.75 => No gap
 * - 0.60–0.75 => IMPROVEMENT
 * - 0.30–0.60 => MUST_HAVE: MAJOR_GAP, NICE_TO_HAVE: MINOR_GAP
 * - < 0.30 => MUST_HAVE: CRITICAL_SKILL_GAP, NICE_TO_HAVE: MINOR_GAP
 * - NO_EVIDENCE => MUST_HAVE: CRITICAL_SKILL_GAP, NICE_TO_HAVE: MINOR_GAP
 */

// =============================================================================
// TYPES
// =============================================================================

export type GapSeverity = 'CRITICAL_SKILL_GAP' | 'MAJOR_GAP' | 'MINOR_GAP' | 'IMPROVEMENT' | 'NO_GAP'

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
  similarity: number | null // null if NO_EVIDENCE
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
    improvement: number
    noGap: number
  }
}

// =============================================================================
// THRESHOLDS
// =============================================================================

const GAP_THRESHOLDS = {
  NO_GAP: 0.75,
  IMPROVEMENT: 0.60,
  MAJOR_GAP: 0.30,
  // Below 0.30 = CRITICAL_SKILL_GAP for MUST_HAVE
} as const

// =============================================================================
// SERVICE
// =============================================================================

@Injectable()
export class GapDetector {
  /**
   * Detect gaps from semantic evaluation results.
   */
  detectGaps(
    evaluationResults: RuleEvaluationResult[],
    ruleTypes: Map<string, RuleType>, // ruleId → RuleType
  ): GapDetectionResult {
    const gaps: Gap[] = []
    let gapCounter = 0

    for (const result of evaluationResults) {
      const ruleType = ruleTypes.get(result.ruleId) || 'NICE_TO_HAVE'

      // Process each chunk's evidence
      for (const chunkEvidence of result.chunkEvidence) {
        const gap = this.detectGapForChunk(
          result.ruleId,
          result.ruleKey,
          chunkEvidence,
          ruleType,
          ++gapCounter,
        )

        if (gap.severity !== 'NO_GAP') {
          gaps.push(gap)
        }
      }
    }

    return this.buildSummary(gaps)
  }

  /**
   * Detect gap for a single rule chunk.
   */
  private detectGapForChunk(
    ruleId: string,
    ruleKey: string,
    chunkEvidence: RuleChunkEvidence,
    ruleType: RuleType,
    gapCounter: number,
  ): Gap {
    const { ruleChunkId, ruleChunkContent, bestCandidate, bestBand } = chunkEvidence

    // Determine similarity (null if no candidate)
    const similarity = bestCandidate?.similarity ?? null

    // Determine severity based on similarity and rule type
    const severity = this.determineSeverity(similarity, bestBand, ruleType)

    // Generate deterministic reason
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

  /**
   * Determine gap severity based on similarity and rule type.
   */
  private determineSeverity(
    similarity: number | null,
    band: SimilarityBand,
    ruleType: RuleType,
  ): GapSeverity {
    // NO_EVIDENCE case
    if (band === 'NO_EVIDENCE' || similarity === null) {
      return ruleType === 'MUST_HAVE' ? 'CRITICAL_SKILL_GAP' : 'MINOR_GAP'
    }

    // HIGH band = no gap
    if (band === 'HIGH' || similarity >= GAP_THRESHOLDS.NO_GAP) {
      return 'NO_GAP'
    }

    // AMBIGUOUS band (0.60–0.75) = IMPROVEMENT
    if (similarity >= GAP_THRESHOLDS.IMPROVEMENT) {
      return 'IMPROVEMENT'
    }

    // LOW band with similarity 0.30–0.60
    if (similarity >= GAP_THRESHOLDS.MAJOR_GAP) {
      return ruleType === 'MUST_HAVE' ? 'MAJOR_GAP' : 'MINOR_GAP'
    }

    // Very low similarity (< 0.30)
    return ruleType === 'MUST_HAVE' ? 'CRITICAL_SKILL_GAP' : 'MINOR_GAP'
  }

  /**
   * Generate deterministic reason for the gap.
   */
  private generateReason(
    similarity: number | null,
    band: SimilarityBand,
    ruleType: RuleType,
    severity: GapSeverity,
  ): string {
    if (band === 'NO_EVIDENCE' || similarity === null) {
      return `No CV content found that matches this ${ruleType === 'MUST_HAVE' ? 'required' : 'recommended'} skill.`
    }

    switch (severity) {
      case 'NO_GAP':
        return `Strong match found (similarity: ${(similarity * 100).toFixed(0)}%).`

      case 'IMPROVEMENT':
        return `Partial match found (similarity: ${(similarity * 100).toFixed(0)}%). Consider expanding with more specific examples.`

      case 'MINOR_GAP':
        return `Weak match found (similarity: ${(similarity * 100).toFixed(0)}%). This is a nice-to-have skill that could strengthen your CV.`

      case 'MAJOR_GAP':
        return `Insufficient evidence found (similarity: ${(similarity * 100).toFixed(0)}%). This is a required skill with limited supporting evidence.`

      case 'CRITICAL_SKILL_GAP':
        return `Critical gap: Very weak or no evidence (similarity: ${similarity !== null ? (similarity * 100).toFixed(0) : '0'}%). This required skill is missing from your CV.`

      default:
        return `Gap detected with severity: ${severity}.`
    }
  }

  /**
   * Build summary from gaps.
   */
  private buildSummary(gaps: Gap[]): GapDetectionResult {
    const summary = {
      total: gaps.length,
      critical: gaps.filter((g) => g.severity === 'CRITICAL_SKILL_GAP').length,
      major: gaps.filter((g) => g.severity === 'MAJOR_GAP').length,
      minor: gaps.filter((g) => g.severity === 'MINOR_GAP').length,
      improvement: gaps.filter((g) => g.severity === 'IMPROVEMENT').length,
      noGap: gaps.filter((g) => g.severity === 'NO_GAP').length,
    }

    return { gaps, summary }
  }

  /**
   * Get gaps by severity threshold.
   */
  filterGapsBySeverity(
    result: GapDetectionResult,
    minSeverity: GapSeverity,
  ): Gap[] {
    const severityOrder: GapSeverity[] = [
      'CRITICAL_SKILL_GAP',
      'MAJOR_GAP',
      'MINOR_GAP',
      'IMPROVEMENT',
      'NO_GAP',
    ]

    const minIndex = severityOrder.indexOf(minSeverity)
    return result.gaps.filter((g) => severityOrder.indexOf(g.severity) <= minIndex)
  }
}
