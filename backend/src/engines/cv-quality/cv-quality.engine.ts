import { Injectable } from '@nestjs/common'
import { CvRepo } from 'src/routes/cv/cv.repo'
import type { CvQualityResultDTO, CvQualityFindingDTO } from 'src/routes/evaluation/evaluation.dto'
import type { CvDecisionType, EvidenceType } from 'src/routes/evaluation/evaluation.model'
import { CV_QUALITY_RULES, CV_QUALITY_RULE_SET_VERSION } from 'src/rules/student-fresher/cv-quality.rules'

/**
 * CV Quality Engine
 *
 * Responsibilities:
 * - Execute CV quality rule set deterministically
 * - Return findings with traceable evidence (chunk-level or section-level)
 * - Enforce MUST_HAVE violations → NOT_READY
 *
 * Forbidden:
 * - Any vector similarity or thresholds
 * - Any JD logic
 * - Any LLM calls
 */
@Injectable()
export class CvQualityEngine {
  constructor(private readonly cvRepo: CvRepo) {}

  async evaluate(cvId: string): Promise<CvQualityResultDTO> {
    // Load CV with sections and chunks
    const cv = await this.cvRepo.findCvByIdWithSectionsAndChunks(cvId)
    if (!cv) {
      throw new Error('CV not found')
    }

    const findings: CvQualityFindingDTO[] = []

    // Execute each rule
    for (const rule of CV_QUALITY_RULES) {
      const result = rule.evaluate(cv)
      findings.push(result)
    }

    // Separate findings by category
    const mustHaveViolations = findings.filter((f) => f.category === 'MUST_HAVE' && !f.passed)
    const niceToHaveFindings = findings.filter((f) => f.category === 'NICE_TO_HAVE')
    const bestPracticeFindings = findings.filter((f) => f.category === 'BEST_PRACTICE')

    // Determine decision
    let decision: CvDecisionType
    if (mustHaveViolations.length > 0) {
      decision = 'NOT_READY'
    } else {
      const failedNice = niceToHaveFindings.filter((f) => !f.passed).length
      const failedBest = bestPracticeFindings.filter((f) => !f.passed).length
      if (failedNice > 2 || failedBest > 3) {
        decision = 'NEEDS_IMPROVEMENT'
      } else {
        decision = 'READY'
      }
    }

    // Calculate scores
    const mustHaveTotal = findings.filter((f) => f.category === 'MUST_HAVE').length
    const mustHavePassed = mustHaveTotal - mustHaveViolations.length
    const mustHaveScore = mustHaveTotal > 0 ? (mustHavePassed / mustHaveTotal) * 100 : 100

    const niceTotal = niceToHaveFindings.length
    const nicePassed = niceToHaveFindings.filter((f) => f.passed).length
    const niceToHaveScore = niceTotal > 0 ? (nicePassed / niceTotal) * 100 : 100

    const bestTotal = bestPracticeFindings.length
    const bestPassed = bestPracticeFindings.filter((f) => f.passed).length
    const bestPracticeScore = bestTotal > 0 ? (bestPassed / bestTotal) * 100 : 100

    // Weighted total (MUST_HAVE: 50%, NICE: 30%, BEST: 20%)
    const totalScore = mustHaveScore * 0.5 + niceToHaveScore * 0.3 + bestPracticeScore * 0.2

    return {
      decision,
      mustHaveViolations,
      niceToHaveFindings,
      bestPracticeFindings,
      scores: {
        mustHaveScore: Math.round(mustHaveScore * 100) / 100,
        niceToHaveScore: Math.round(niceToHaveScore * 100) / 100,
        bestPracticeScore: Math.round(bestPracticeScore * 100) / 100,
        totalScore: Math.round(totalScore * 100) / 100,
      },
      ruleSetVersion: CV_QUALITY_RULE_SET_VERSION,
    }
  }
}

// Helper to create section evidence
export function createSectionEvidence(cvId: string, sectionType: string, sectionId?: string): EvidenceType {
  return {
    type: 'section',
    cvId,
    sectionType,
    sectionId,
  }
}

// Helper to create chunk evidence
export function createChunkEvidence(
  cvId: string,
  sectionType: string,
  sectionId: string,
  chunkId: string,
  chunkOrder: number,
  snippet: string,
): EvidenceType {
  return {
    type: 'chunk',
    cvId,
    sectionType,
    sectionId,
    chunkId,
    chunkOrder,
    snippet,
  }
}
