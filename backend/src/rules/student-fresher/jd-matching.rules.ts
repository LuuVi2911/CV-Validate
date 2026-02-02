/**
 * JD Matching Rule Set for Student/Fresher roles
 *
 * This file contains:
 * - Rule set version for traceability
 * - Scoring weights for JD matching
 * - Deterministic thresholds for match level calculation
 *
 * Note: JD rules themselves are extracted dynamically from JD text
 * using heuristics in JdRuleExtractionService. This file only contains
 * the configuration for how those rules are weighted and scored.
 */

export const JD_MATCHING_RULE_SET_VERSION = 'student-fresher.jd-matching@2026-01-29'

// Rule type weights for overall score calculation
export const RULE_TYPE_WEIGHTS = {
  MUST_HAVE: 0.5, // 50% weight
  NICE_TO_HAVE: 0.3, // 30% weight
  BEST_PRACTICE: 0.2, // 20% weight
} as const

// Match level thresholds (deterministic)
export const MATCH_LEVEL_THRESHOLDS = {
  STRONG_MATCH: {
    satisfactionRate: 0.85,
    mustHaveCoverage: 0.9,
  },
  GOOD_MATCH: {
    satisfactionRate: 0.65,
    mustHaveCoverage: 0.75,
  },
  PARTIAL_MATCH: {
    satisfactionRate: 0.4,
    mustHaveCoverage: 0.5,
  },
  // Below PARTIAL_MATCH thresholds = LOW_MATCH
} as const

// Suggestion templates by rule type and target
export const SUGGESTION_TEMPLATES = {
  MUST_HAVE: {
    default: 'Consider adding content that demonstrates: "{content}"',
    skills: 'Add "{content}" to your Skills section',
    experience: 'Highlight experience with "{content}" in your work history',
    project: 'Include a project that showcases "{content}"',
  },
  NICE_TO_HAVE: {
    default: 'Your CV would be stronger with evidence of: "{content}"',
    skills: 'Consider adding "{content}" to differentiate yourself',
    experience: 'If you have experience with "{content}", consider adding it',
    project: 'A project demonstrating "{content}" would strengthen your application',
  },
  BEST_PRACTICE: {
    default: 'Optional improvement - consider including: "{content}"',
    skills: 'Bonus: "{content}" could be valuable to mention',
    experience: 'If applicable, "{content}" could add extra value',
    project: 'Consider whether any of your projects relate to "{content}"',
  },
} as const

// Cue phrases for deterministic rule type classification
// Used by JdRuleExtractionService
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
