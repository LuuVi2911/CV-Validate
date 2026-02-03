/**
 * JD MATCHING CONFIGURATION
 * APPLICABLE TO: STUDENT / FRESHER
 * PURPOSE: CV–JD RELEVANCE EVALUATION VIA EMBEDDINGS
 *
 * Based on: Match JD rules.pdf
 *
 * =============================================================================
 * HYBRID EVALUATION MODEL
 * =============================================================================
 *
 * JD matching uses SEMANTIC EVALUATION via embeddings:
 * 1. JD rules are extracted from JD text (JdRuleExtractionService)
 * 2. JD rule chunks are embedded (same model as CV chunks)
 * 3. SemanticEvaluator performs pgvector similarity search
 * 4. Results are aggregated into match status (FULL/PARTIAL/NONE/NO_EVIDENCE)
 *
 * NO KEYWORD MATCHING - all evaluation is embedding-based.
 *
 * MATCHING PRINCIPLES:
 * - JD matching does not override CV quality requirements
 * - A high-quality CV can still be a weak match for a specific JD
 * - Matching is evaluated via semantic similarity, not keyword overlap
 *
 * CRITICAL PRINCIPLE:
 * AMBIGUOUS similarity does NOT mean failure.
 * For fresher CVs, AMBIGUOUS similarity usually means "relevant but under-expressed".
 *
 * =============================================================================
 */

export const JD_MATCHING_RULE_SET_VERSION = `student-fresher.jd-matching@2026-02-03-v2`

// =============================================================================
// JD MATCHING RULE CATEGORIES (Reference only - actual rules extracted from JD)
// =============================================================================

/**
 * MUST_MATCH (MUST_HAVE): Core fit requirements
 * - Required Skill Coverage
 * - Skill Usage Evidence
 * - Role Type Consistency
 * - Level Fit
 */

/**
 * NICE_TO_MATCH (NICE_TO_HAVE): Quality of fit signals
 * - Skill Depth Alignment
 * - Tool or Environment Overlap
 * - Task and Responsibility Alignment
 * - Domain Familiarity
 */

/**
 * BEST_PRACTICE: Strong match signals
 * - Directly Relevant Experience or Project
 * - Relevant Outcomes
 * - Learning and Adaptability Signals
 */

// =============================================================================
// MATCH STATUS SCORING
// =============================================================================

/**
 * Match status scoring weights (used by SemanticEvaluator)
 * - FULL: Strong evidence (HIGH band) → 1.0
 * - PARTIAL: Relevant but incomplete (AMBIGUOUS band) → 0.5
 * - NONE: Missing or weak evidence (LOW band) → 0.0
 * - NO_EVIDENCE: Below SIM_FLOOR → 0.0
 *
 * CRITICAL: PARTIAL is NOT zero. It represents meaningful partial credit.
 */
export const MATCH_STATUS_SCORES = {
  FULL: 1.0,
  PARTIAL: 0.5,
  NONE: 0.0,
  NO_EVIDENCE: 0.0,
} as const

/**
 * Rule type multipliers for weighted scoring
 */
export const RULE_TYPE_MULTIPLIERS = {
  MUST_HAVE: 1.0,
  NICE_TO_HAVE: 0.5,
  BEST_PRACTICE: 0.25,
} as const

/**
 * Rule type weights for overall category scoring
 */
export const RULE_TYPE_WEIGHTS = {
  MUST_HAVE: 0.5,
  NICE_TO_HAVE: 0.3,
  BEST_PRACTICE: 0.2,
} as const

// =============================================================================
// SIMILARITY BAND → MATCH STATUS MAPPING
// =============================================================================

/**
 * Explicit similarity band semantics (from similarity.contract.ts):
 * - HIGH (>= SIM_HIGH_THRESHOLD) → FULL
 * - AMBIGUOUS (>= SIM_LOW_THRESHOLD and < SIM_HIGH_THRESHOLD) → PARTIAL
 * - LOW (< SIM_LOW_THRESHOLD) → NONE
 * - NO_EVIDENCE (below SIM_FLOOR) → NO_EVIDENCE
 */
export const BAND_TO_MATCH_STATUS = {
  HIGH: 'FULL',
  AMBIGUOUS: 'PARTIAL',
  LOW: 'NONE',
  NO_EVIDENCE: 'NO_EVIDENCE',
} as const

// =============================================================================
// SECTION-AWARE UPGRADE CONFIGURATION
// =============================================================================

/**
 * Sections that allow PARTIAL → FULL upgrade for AMBIGUOUS matches
 * Rationale: PROJECTS and EXPERIENCE provide strong contextual evidence
 */
export const UPGRADE_ELIGIBLE_SECTIONS = ['PROJECTS', 'EXPERIENCE'] as const

/**
 * Sections that should remain PARTIAL (no upgrade)
 */
export const NO_UPGRADE_SECTIONS = ['SKILLS', 'SUMMARY', 'EDUCATION', 'ACTIVITIES'] as const

// =============================================================================
// MATCH LEVEL THRESHOLDS
// =============================================================================

/**
 * Thresholds for determining overall JD match level
 * Uses weighted scores (FULL=1.0, PARTIAL=0.5, NONE=0.0)
 */
export const MATCH_LEVEL_THRESHOLDS = {
  STRONG_MATCH: {
    weightedScoreRate: 0.85,
    mustHaveScoreRate: 0.9,
  },
  GOOD_MATCH: {
    weightedScoreRate: 0.65,
    mustHaveScoreRate: 0.75,
  },
  PARTIAL_MATCH: {
    weightedScoreRate: 0.35,
    mustHaveScoreRate: 0.4,
  },
  // Below PARTIAL_MATCH thresholds = LOW_MATCH
} as const

// =============================================================================
// GAP DETECTION CONFIGURATION
// =============================================================================

/**
 * Gap creation rules:
 * - Only create gaps for matchStatus = NONE or NO_EVIDENCE
 * - Only for MUST_HAVE and NICE_TO_HAVE (not BEST_PRACTICE)
 * - PARTIAL matches are NOT gaps
 */
export const GAP_ELIGIBLE_RULE_TYPES = ['MUST_HAVE', 'NICE_TO_HAVE'] as const

/**
 * Gap severity mapping (from GapDetector):
 * - MUST_HAVE + NO_EVIDENCE → CRITICAL_SKILL_GAP
 * - MUST_HAVE + NONE → MAJOR_GAP
 * - NICE_TO_HAVE + NO_EVIDENCE → MAJOR_GAP
 * - NICE_TO_HAVE + NONE → MINOR_GAP
 */
export const GAP_SEVERITY = {
  MUST_HAVE: { NO_EVIDENCE: 'CRITICAL_SKILL_GAP', NONE: 'MAJOR_GAP' },
  NICE_TO_HAVE: { NO_EVIDENCE: 'MAJOR_GAP', NONE: 'MINOR_GAP' },
} as const

// =============================================================================
// SUGGESTION CONFIGURATION
// =============================================================================

/**
 * Suggestion types based on match status:
 * - PARTIAL → type: 'PARTIAL', action: EXPAND_BULLET
 * - NONE/NO_EVIDENCE → type: 'MISSING', action: ADD_BULLET
 *
 * Suggestions use "concept labels" extracted from rule chunks,
 * NOT raw JD text or hardcoded keywords.
 */
export const SUGGESTION_ACTION_TYPES = {
  PARTIAL: 'EXPAND_BULLET',
  MISSING: 'ADD_BULLET',
} as const

// =============================================================================
// RULE TYPE CUE PHRASES (for JdRuleExtractionService)
// =============================================================================

export const RULE_TYPE_CUE_PHRASES = {
  MUST_HAVE: ['must', 'required', 'need to', 'minimum', 'mandatory', 'essential', 'necessário', 'cần có', 'bắt buộc'],
  NICE_TO_HAVE: [
    'nice to have',
    'preferred',
    'plus',
    'bonus',
    'advantage',
    'desirable',
    'ideally',
    'ưu tiên',
    'là một lợi thế',
  ],
  // Everything else defaults to BEST_PRACTICE
} as const
