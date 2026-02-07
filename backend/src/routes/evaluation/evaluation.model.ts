import { z } from 'zod'

// Enums
export const CvDecisionSchema = z.enum(['NOT_READY', 'NEEDS_IMPROVEMENT', 'READY'])
export type CvDecisionType = z.infer<typeof CvDecisionSchema>

export const JdMatchLevelSchema = z.enum(['LOW_MATCH', 'PARTIAL_MATCH', 'GOOD_MATCH', 'STRONG_MATCH'])
export type JdMatchLevelType = z.infer<typeof JdMatchLevelSchema>

// Include NO_EVIDENCE for candidates below SIM_FLOOR
export const SimilarityBandSchema = z.enum(['HIGH', 'AMBIGUOUS', 'LOW', 'NO_EVIDENCE'])
export type SimilarityBandType = z.infer<typeof SimilarityBandSchema>

// Match status at RULE level (not chunk level)
// FULL = strong evidence, PARTIAL = relevant but incomplete, NONE = weak evidence, NO_EVIDENCE = no candidates above floor
export const MatchStatusSchema = z.enum(['FULL', 'PARTIAL', 'NONE', 'NO_EVIDENCE'])
export type MatchStatusType = z.infer<typeof MatchStatusSchema>

export const RuleCategorySchema = z.enum(['MUST_HAVE', 'NICE_TO_HAVE', 'BEST_PRACTICE'])
export type RuleCategoryType = z.infer<typeof RuleCategorySchema>

// Gap severity for strict gap detection
export const GapSeveritySchema = z.enum(['CRITICAL_SKILL_GAP', 'MAJOR_GAP', 'MINOR_GAP', 'IMPROVEMENT', 'NO_GAP'])
export type GapSeverityType = z.infer<typeof GapSeveritySchema>

// Evidence types
export const SectionEvidenceSchema = z.object({
  type: z.literal('section'),
  cvId: z.string().uuid(),
  sectionType: z.string(),
  sectionId: z.string().uuid().optional(),
})

export const ChunkEvidenceSchema = z.object({
  type: z.literal('chunk'),
  cvId: z.string().uuid(),
  sectionType: z.string(),
  sectionId: z.string().uuid(),
  chunkId: z.string().uuid(),
  chunkOrder: z.number().int(),
  snippet: z.string(),
})

export const EvidenceSchema = z.discriminatedUnion('type', [SectionEvidenceSchema, ChunkEvidenceSchema])
export type EvidenceType = z.infer<typeof EvidenceSchema>

// CV Quality Finding
export const CvQualityFindingSchema = z.object({
  ruleId: z.string(),
  category: RuleCategorySchema,
  passed: z.boolean(),
  severity: z.enum(['critical', 'warning', 'info']),
  reason: z.string(),
  evidence: z.array(EvidenceSchema),
})

// CV Quality Result
export const CvQualityResultSchema = z.object({
  decision: CvDecisionSchema,
  mustHaveViolations: z.array(CvQualityFindingSchema),
  niceToHaveFindings: z.array(CvQualityFindingSchema),
  bestPracticeFindings: z.array(CvQualityFindingSchema),
  scores: z.object({
    mustHaveScore: z.number(),
    niceToHaveScore: z.number(),
    bestPracticeScore: z.number(),
    totalScore: z.number(),
  }),
  ruleSetVersion: z.string(),
})

// Match candidate
export const MatchCandidateSchema = z.object({
  cvChunkId: z.string().uuid(),
  sectionId: z.string().uuid(),
  sectionType: z.string(),
  score: z.number(),
  band: SimilarityBandSchema,
})

// Chunk-level match evidence (internal, for debugging)
export const ChunkMatchEvidenceSchema = z.object({
  ruleChunkId: z.string().uuid(),
  ruleChunkContent: z.string(),
  candidates: z.array(MatchCandidateSchema),
  bestCandidate: MatchCandidateSchema.nullable(),
  bandStatus: SimilarityBandSchema.nullable(), // Band of best candidate
  judgeUsed: z.boolean(),
  judgeSkipped: z.boolean(),
  judgeUnavailable: z.boolean(),
  judgeResult: z
    .object({
      status: z.enum(['FULL', 'PARTIAL', 'NONE']),
      reason: z.string(),
      confidence: z.enum(['low', 'medium', 'high']).optional(),
    })
    .nullable(),
})

// Match trace entry (per JD RULE - rule-level decision)
export const MatchTraceEntrySchema = z.object({
  ruleId: z.string().uuid(),
  ruleType: RuleCategorySchema,
  ruleContent: z.string(), // Combined content from all chunks
  chunkEvidence: z.array(ChunkMatchEvidenceSchema),
  matchStatus: MatchStatusSchema, // FULL | PARTIAL | NONE
  bestChunkMatch: z
    .object({
      ruleChunkId: z.string().uuid(),
      cvChunkId: z.string().uuid(),
      sectionType: z.string(),
      score: z.number(),
      band: SimilarityBandSchema,
    })
    .nullable(),
  // Section upgrade info
  sectionUpgradeApplied: z.boolean().optional(),
  upgradeFromSection: z.string().optional(),
  // Scoring
  score: z.number(), // 1.0 for FULL, 0.5 for PARTIAL, 0.0 for NONE
  weightedScore: z.number(), // score × rule type multiplier
  // Debugging & Details
  llmJudgeUsed: z.boolean().optional(),
  llmJudgeResult: z.string().optional(),
  missingInfo: z.string().optional(),
  // Multi-mention aggregation
  multiMentionCount: z.number().int().optional(),
  multiMentionBoost: z.boolean().optional(),
  mentionDetails: z
    .object({
      high: z.number().int(),
      medium: z.number().int(),
      low: z.number().int(),
    })
    .optional(),
  // Legacy compatibility
  satisfied: z.boolean(), // true if matchStatus !== NONE
})

// Gap - created for NONE/NO_EVIDENCE matches
export const GapSchema = z.object({
  gapId: z.string(),
  ruleId: z.string().uuid(),
  ruleKey: z.string(),
  ruleChunkId: z.string().uuid(),
  ruleChunkContent: z.string(),
  ruleType: RuleCategorySchema,
  bestCvChunkId: z.string().uuid().nullable(),
  bestCvChunkSnippet: z.string().nullable(),
  sectionType: z.string().nullable(),
  similarity: z.number().nullable(), // null if NO_EVIDENCE
  band: SimilarityBandSchema,
  severity: GapSeveritySchema,
  reason: z.string(),
})

// Suggestion action types
export const SuggestionActionTypeSchema = z.enum(['ADD_BULLET', 'EXPAND_BULLET', 'ADD_METRIC', 'ADD_LINK'])
export type SuggestionActionType = z.infer<typeof SuggestionActionTypeSchema>

// Suggestion - different for PARTIAL (expand) vs MISSING (add)
export const SuggestionSchema = z.object({
  suggestionId: z.string(),
  ruleId: z.string().uuid(),
  ruleKey: z.string(),
  ruleChunkId: z.string().uuid(),
  severity: GapSeveritySchema,
  type: z.enum(['MISSING', 'PARTIAL']),
  message: z.string(),
  targetCvChunkId: z.string().uuid().nullable(),
  sectionType: z.string().nullable(),
  evidenceSnippet: z.string().nullable(),
  suggestedActionType: SuggestionActionTypeSchema,
  conceptLabel: z.string(),
})

// Mock Interview Question
export const MockQuestionSchema = z.object({
  question: z.string(),
  expectedTopics: z.array(z.string()),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  type: z.enum(['technical', 'behavioral', 'problem-solving']),
})
export type MockQuestionType = z.infer<typeof MockQuestionSchema>

// JD Match Result
export const JdMatchResultSchema = z.object({
  level: JdMatchLevelSchema,
  matchTrace: z.array(MatchTraceEntrySchema),
  gaps: z.array(GapSchema),
  suggestions: z.array(SuggestionSchema),
  scores: z.object({
    mustHaveScore: z.number(),
    niceToHaveScore: z.number(),
    bestPracticeScore: z.number(),
    totalScore: z.number(),
  }),
})

// Trace/Audit metadata
export const TraceMetadataSchema = z.object({
  requestId: z.string().uuid(),
  cvId: z.string().uuid(),
  jdId: z.string().uuid().optional(),
  ruleSetVersion: z.string(),
  timingsMs: z.object({
    total: z.number(),
  }),
})

// Decision Support
export const DecisionSupportSchema = z.object({
  readinessScore: z.number(), // 0-100
  recommendation: z.enum(['NOT_READY', 'NEEDS_IMPROVEMENT', 'READY_TO_APPLY']),
  explanation: z.object({
    criticalMustHaveGaps: z.number(),
    majorGaps: z.number(),
    improvementAreas: z.number(),
  }),
})

// Evaluation Request
export const RunEvaluationBodySchema = z
  .object({
    cvId: z.string().uuid(),
    jdId: z.string().uuid().optional(),
  })
  .strict()

export const EvaluationResultSchema = z.object({
  evaluationId: z.string().uuid(),
  cvQuality: CvQualityResultSchema,
  jdMatch: JdMatchResultSchema.optional().nullable(),
  mockQuestions: z.array(MockQuestionSchema).optional(),
  decisionSupport: DecisionSupportSchema,
  trace: TraceMetadataSchema,
})

// --- Evaluation Summary Schemas (Customized) ---

export const SummaryFailedFindingSchema = z.object({
  category: z.string(),
  reason: z.string(),
})

export const SummaryMatchSchema = z.object({
  ruleType: z.enum(['MUST_HAVE', 'NICE_TO_HAVE', 'BEST_PRACTICE']),
  ruleContent: z.string(),
  judgeReason: z.string(),
  score: z.number(),
  weightedScore: z.number(),
  satisfied: z.boolean(),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
})

export const SummaryGapSchema = z.object({
  ruleChunkContent: z.string(),
  ruleType: z.enum(['MUST_HAVE', 'NICE_TO_HAVE', 'BEST_PRACTICE']),
  reason: z.string(),
})

export const SummarySuggestionSchema = z.object({
  severity: z.enum(['CRITICAL', 'IMPORTANT', 'NICE_TO_HAVE']),
  type: z.enum(['CONTENT_GAP', 'WEAK_EVIDENCE', 'FORMATTING', 'CLARITY']),
  message: z.string(),
  evidenceSnippet: z.string(),
  suggestedActionType: z.enum(['ADD_KEYWORD', 'REWRITE_SECTION', 'ADD_SECTION', 'QUANTIFY_IMPACT']),
  conceptLabel: z.string(),
  sectionType: z.string(),
})

// Evaluation Summary (lightweight for FE)
export const EvaluationSummarySchema = z.object({
  evaluationId: z.string().uuid(),
  cvId: z.string().uuid(),
  jdId: z.string().uuid(),
  cvQuality: z.object({
    failedFindings: z.array(SummaryFailedFindingSchema),
  }),
  jdMatch: z.object({
    matches: z.array(SummaryMatchSchema),
    scores: z.object({
      mustHaveScore: z.number(),
      niceToHaveScore: z.number(),
      bestPracticeScore: z.number(),
      totalScore: z.number(),
    }),
    level: JdMatchLevelSchema,
    gaps: z.array(SummaryGapSchema),
    suggestions: z.array(SummarySuggestionSchema),
  }),
  decisionSupport: DecisionSupportSchema,
})
