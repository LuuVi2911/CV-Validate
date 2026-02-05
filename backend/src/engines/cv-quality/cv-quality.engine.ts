import { Injectable } from '@nestjs/common'
import { CvRepo } from 'src/routes/cv/cv.repo'
import type { CvQualityResultDTO, CvQualityFindingDTO } from 'src/routes/evaluation/evaluation.dto'
import type { CvDecisionType, EvidenceType } from 'src/routes/evaluation/evaluation.model'
import { CV_STRUCTURAL_RULES, CV_QUALITY_RULE_SET_VERSION } from 'src/rules/student-fresher/cv-quality.rules'
import envConfig from 'src/shared/config'
import { PrismaService } from 'src/shared/services/prisma.service'
import { SemanticEvaluator } from 'src/engines/semantic/semantic-evaluator'
import type { CvSectionType, RuleSeverity, RuleType } from 'src/generated/prisma/enums'

/**
 * CV Quality Engine
 *
 * Responsibilities:
 * - Execute STRUCTURAL CV quality rules (format/pattern checks)
 * - SEMANTIC rules are evaluated separately via SemanticEvaluator
 * - Return findings with traceable evidence (chunk-level or section-level)
 * - Enforce MUST_HAVE violations → NOT_READY
 *
 * Forbidden:
 * - Keyword-based semantic matching (use embeddings instead)
 * - Any JD logic
 * - Any LLM calls
 */
@Injectable()
export class CvQualityEngine {
  constructor(
    private readonly cvRepo: CvRepo,
    private readonly prisma: PrismaService,
    private readonly semanticEvaluator: SemanticEvaluator,
  ) { }

  async evaluate(
    cvId: string,
    options?: {
      includeSemantic?: boolean
      semanticRuleSetKey?: string
    },
  ): Promise<CvQualityResultDTO> {
    // Load CV with sections and chunks
    const cv = await this.cvRepo.findCvByIdWithSectionsAndChunks(cvId)
    if (!cv) {
      throw new Error('CV not found')
    }

    const findings: CvQualityFindingDTO[] = []

    // Execute only STRUCTURAL rules (which have evaluate functions)
    // SEMANTIC rules are evaluated via SemanticEvaluator with embedded rules
    for (const rule of CV_STRUCTURAL_RULES) {
      const result = rule.evaluate(cv)
      findings.push(result)
    }

    const includeSemantic = options?.includeSemantic ?? false
    const semanticRuleSetKey = options?.semanticRuleSetKey ?? 'cv-quality-student-fresher'

    if (includeSemantic) {
      const semantic = await this.semanticEvaluator.evaluateCvQualityRules(cvId, semanticRuleSetKey, {
        topK: envConfig.MATCH_TOP_K,
        thresholds: {
          floor: envConfig.SIM_FLOOR,
          low: envConfig.SIM_LOW_THRESHOLD,
          high: envConfig.SIM_HIGH_THRESHOLD,
        },
      })

      // Load rule metadata for mapping category/severity deterministically
      const ruleMeta = await this.prisma.ruleSet.findUnique({
        where: { key: semanticRuleSetKey },
        include: {
          rules: {
            select: {
              ruleKey: true,
              category: true,
              severity: true,
            },
          },
        },
      })
      const metaMap = new Map<string, { category: RuleType; severity: RuleSeverity }>()
      for (const r of ruleMeta?.rules ?? []) {
        metaMap.set(r.ruleKey, { category: r.category, severity: r.severity })
      }

      for (const r of semantic.results) {
        const meta = metaMap.get(r.ruleKey)
        const category: RuleType =
          meta?.category ??
          (r.ruleKey.includes('-MH-') ? 'MUST_HAVE' : r.ruleKey.includes('-NH-') ? 'NICE_TO_HAVE' : 'BEST_PRACTICE')
        const severity: RuleSeverity =
          meta?.severity ?? (category === 'MUST_HAVE' ? 'critical' : category === 'NICE_TO_HAVE' ? 'warning' : 'info')

        const passed = r.result === 'FULL' || r.result === 'PARTIAL'
        const best = r.bestMatch

        const evidence: EvidenceType[] = best
          ? [createChunkEvidence(cvId, best.sectionType, best.sectionId, best.cvChunkId, best.chunkOrder, best.snippet)]
          : [createSectionEvidence(cvId, 'SUMMARY')]

        const bestSim = best ? best.similarity.toFixed(2) : 'n/a'
        const bestBand = best?.band ?? 'NO_EVIDENCE'

        findings.push({
          ruleId: r.ruleKey,
          category: category as unknown as any,
          passed,
          severity: severity as unknown as any,
          reason: passed
            ? `Semantic evidence: ${r.result}${r.upgraded ? ' (upgraded)' : ''} (best ${bestSim}, ${bestBand})`
            : `No sufficient semantic evidence (best ${bestSim}, ${bestBand})`,
          evidence,
        })
      }
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
      niceToHaveFindings: niceToHaveFindings.filter((f) => !f.passed),
      bestPracticeFindings: bestPracticeFindings.filter((f) => !f.passed),
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
