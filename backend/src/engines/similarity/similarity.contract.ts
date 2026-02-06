/**
 * CANONICAL SIMILARITY CONTRACT
 *
 * This file defines the SINGLE SOURCE OF TRUTH for similarity computation
 * in the CV Enhancer system. ALL engines MUST use these definitions.
 */

import type { CvSectionType } from 'src/generated/prisma/enums'

// Vector operator (pgvector)

/**
 * pgvector operator: <=> (cosine distance)
 * Returns distance in range [0, 2] where:
 * - 0 = identical vectors
 * - 1 = orthogonal vectors
 * - 2 = opposite vectors
 */
export const VECTOR_OPERATOR = '<=>' as const

// Similarity transform

/**
 * Convert cosine distance to similarity.
 * similarity = 1 - cosine_distance
 *
 * Result range: [-1, 1] where:
 *  1 = identical
 *  0 = orthogonal
 * -1 = opposite
 */
export function distanceToSimilarity(distance: number): number {
  return 1 - distance
}

/**
 * Convert similarity back to distance (for SQL queries).
 * distance = 1 - similarity
 */
export function similarityToDistance(similarity: number): number {
  return 1 - similarity
}

// Similarity bands

export type SimilarityBand = 'HIGH' | 'AMBIGUOUS' | 'LOW' | 'NO_EVIDENCE'

export interface SimilarityThresholds {
  floor: number // Below this = NO_EVIDENCE (no candidate)
  low: number // [floor, low) = LOW
  high: number // [low, high) = AMBIGUOUS, >= high = HIGH
}

/**
 * Classify a similarity score into a band.
 *
 * Banding logic:
 * - similarity < floor => NO_EVIDENCE (candidate should be filtered out)
 * - similarity >= high => HIGH
 * - similarity >= low => AMBIGUOUS
 * - else => LOW
 */
export function classifySimilarityBand(
  similarity: number,
  thresholds: SimilarityThresholds,
): SimilarityBand {
  if (similarity < thresholds.floor) return 'NO_EVIDENCE'
  if (similarity >= thresholds.high) return 'HIGH'
  if (similarity >= thresholds.low) return 'AMBIGUOUS'
  return 'LOW'
}

/**
 * Check if a similarity score passes the floor threshold.
 * Candidates below floor should be treated as NO_EVIDENCE.
 */
export function passesFloor(similarity: number, floor: number): boolean {
  return similarity >= floor
}

// Rule-level aggregation

export type RuleLevelResult = 'FULL' | 'PARTIAL' | 'NONE' | 'NO_EVIDENCE'

/**
 * Aggregate multiple chunk-level bands into a rule-level result.
 *
 * Logic:
 * - FULL: any chunk has HIGH
 * - PARTIAL: none HIGH, but at least one AMBIGUOUS
 * - NONE: no AMBIGUOUS/HIGH, but at least one LOW
 * - NO_EVIDENCE: no candidates above SIM_FLOOR at all
 */
export function aggregateRuleResult(bands: SimilarityBand[]): RuleLevelResult {
  if (bands.length === 0) return 'NO_EVIDENCE'

  const hasHigh = bands.includes('HIGH')
  const hasAmbiguous = bands.includes('AMBIGUOUS')
  const hasLow = bands.includes('LOW')

  if (hasHigh) return 'FULL'
  if (hasAmbiguous) return 'PARTIAL'
  if (hasLow) return 'NONE'
  return 'NO_EVIDENCE'
}

// Section weights (soft ranking)

/**
 * Default section weights for ranking candidates.
 * Higher weight = more relevant section.
 * Used for tie-breaking, NOT hard filtering.
 */
export const DEFAULT_SECTION_WEIGHTS: Record<CvSectionType, number> = {
  EXPERIENCE: 1.15,
  PROJECTS: 1.15,
  SKILLS: 1.05,
  ACTIVITIES: 1.0,
  SUMMARY: 0.9,
  EDUCATION: 0.9,
}

/**
 * Section priority for deterministic tie-breaking when weights are equal.
 * Lower number = higher priority.
 */
export const SECTION_PRIORITY: Record<CvSectionType, number> = {
  EXPERIENCE: 1,
  PROJECTS: 2,
  SKILLS: 3,
  ACTIVITIES: 4,
  EDUCATION: 5,
  SUMMARY: 6,
}

/**
 * Get section weight with optional boost for appliesToSections.
 */
export function getSectionWeight(
  sectionType: CvSectionType,
  appliesToSections?: CvSectionType[] | null,
  boostAmount = 0.1,
): number {
  const baseWeight = DEFAULT_SECTION_WEIGHTS[sectionType] ?? 1.0
  if (appliesToSections && appliesToSections.includes(sectionType)) {
    return baseWeight + boostAmount
  }
  return baseWeight
}

// Deterministic tie-break

export interface CandidateForTieBreak {
  similarity: number
  sectionType: CvSectionType
  sectionWeight: number
  chunkOrder: number
  chunkId: string
}

/**
 * Compare two candidates for deterministic tie-breaking.
 * Returns negative if a < b, positive if a > b, zero if equal.
 *
 * Order:
 * 1. similarity desc
 * 2. sectionWeight desc
 * 3. sectionType priority asc
 * 4. chunkOrder asc
 * 5. chunkId asc (lexicographic)
 */
export function compareCandidates(a: CandidateForTieBreak, b: CandidateForTieBreak): number {
  // 1. Similarity desc
  if (a.similarity !== b.similarity) {
    return b.similarity - a.similarity
  }

  // 2. Section weight desc
  if (a.sectionWeight !== b.sectionWeight) {
    return b.sectionWeight - a.sectionWeight
  }

  // 3. Section priority asc
  const aPriority = SECTION_PRIORITY[a.sectionType] ?? 99
  const bPriority = SECTION_PRIORITY[b.sectionType] ?? 99
  if (aPriority !== bPriority) {
    return aPriority - bPriority
  }

  // 4. Chunk order asc
  if (a.chunkOrder !== b.chunkOrder) {
    return a.chunkOrder - b.chunkOrder
  }

  // 5. Chunk ID asc (lexicographic)
  return a.chunkId.localeCompare(b.chunkId)
}

/**
 * Sort candidates using deterministic tie-break order.
 */
export function sortCandidates<T extends CandidateForTieBreak>(candidates: T[]): T[] {
  return [...candidates].sort(compareCandidates)
}

// Partial → Full upgrade logic

export interface UpgradeConfig {
  /** Allow upgrade only from these sections */
  allowedSections: CvSectionType[]
  /** Similarity must be at least this close to HIGH threshold */
  upgradeMargin: number
  /** Require at least this many supporting candidates above LOW threshold */
  minSupportingCandidates: number
}

export const DEFAULT_UPGRADE_CONFIG: UpgradeConfig = {
  allowedSections: ['EXPERIENCE', 'PROJECTS'],
  upgradeMargin: 0.05,
  minSupportingCandidates: 2,
}

/**
 * Check if a PARTIAL result can be upgraded to FULL.
 *
 * Conditions (all must be met):
 * 1. Best candidate is from allowed section (EXPERIENCE or PROJECTS)
 * 2. Best similarity >= (SIM_HIGH_THRESHOLD - upgradeMargin)
 * 3. At least minSupportingCandidates candidates with similarity >= SIM_LOW_THRESHOLD
 */
export function canUpgradePartialToFull(
  bestCandidate: { sectionType: CvSectionType; similarity: number } | null,
  candidateCount: number,
  thresholds: SimilarityThresholds,
  config: UpgradeConfig = DEFAULT_UPGRADE_CONFIG,
): boolean {
  if (!bestCandidate) return false

  // Condition 1: Section must be allowed
  if (!config.allowedSections.includes(bestCandidate.sectionType)) return false

  // Condition 2: Similarity must be close to HIGH threshold
  const upgradeThreshold = thresholds.high - config.upgradeMargin
  if (bestCandidate.similarity < upgradeThreshold) return false

  // Condition 3: Must have supporting evidence
  if (candidateCount < config.minSupportingCandidates) return false

  return true
}

// Official severity mapping

export type GapSeverity =
  | 'CRITICAL_SKILL_GAP'
  | 'MAJOR_GAP'
  | 'MINOR_GAP'
  | 'PARTIAL_MATCH_ADVISORY'
  | 'ADVISORY'
  | 'NONE'

/**
 * Official Severity Table:
 * | Band         | MUST_HAVE            | NICE_TO_HAVE / BEST_PRACTICE |
 * | :----------- | :------------------- | :--------------------------- |
 * | NO_EVIDENCE  | CRITICAL_SKILL_GAP   | MINOR_GAP                    |
 * | LOW          | CRITICAL_SKILL_GAP   | MINOR_GAP                    |
 * | AMBIGUOUS    | PARTIAL_MATCH_ADVISORY| ADVISORY                     |
 * | HIGH         | NONE                 | NONE                         |
 */
export function getGapSeverity(
  band: SimilarityBand,
  ruleType: 'MUST_HAVE' | 'NICE_TO_HAVE' | 'BEST_PRACTICE',
): GapSeverity {
  if (band === 'HIGH') return 'NONE'

  if (ruleType === 'MUST_HAVE') {
    if (band === 'AMBIGUOUS') return 'PARTIAL_MATCH_ADVISORY'
    return 'CRITICAL_SKILL_GAP'
  } else {
    // NICE_TO_HAVE or BEST_PRACTICE
    if (band === 'AMBIGUOUS') return 'ADVISORY'
    return 'MINOR_GAP'
  }
}

// SQL helpers

/**
 * Generate the ORDER BY clause for deterministic tie-breaking in SQL.
 * Note: Section weight is computed in application layer, not SQL.
 */
export const SQL_ORDER_BY_TIEBREAK = `
  embedding <=> $1 ASC,
  "sectionId" ASC,
  "order" ASC,
  id ASC
` as const

/**
 * Generate a WHERE clause fragment for SIM_FLOOR filtering.
 * Usage: WHERE (1 - (embedding <=> $1)) >= $floor
 */
export function sqlSimFloorCondition(embeddingParam: string, floorParam: string): string {
  return `(1 - (embedding ${VECTOR_OPERATOR} ${embeddingParam})) >= ${floorParam}`
}
