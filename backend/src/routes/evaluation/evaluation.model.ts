import { z } from 'zod'

// Enums
export const CvDecisionSchema = z.enum(['NOT_READY', 'NEEDS_IMPROVEMENT', 'READY'])
export type CvDecisionType = z.infer<typeof CvDecisionSchema>

export const JdMatchLevelSchema = z.enum(['LOW_MATCH', 'PARTIAL_MATCH', 'GOOD_MATCH', 'STRONG_MATCH'])
export type JdMatchLevelType = z.infer<typeof JdMatchLevelSchema>

export const SimilarityBandSchema = z.enum(['HIGH', 'AMBIGUOUS', 'LOW'])
export type SimilarityBandType = z.infer<typeof SimilarityBandSchema>

export const RuleCategorySchema = z.enum(['MUST_HAVE', 'NICE_TO_HAVE', 'BEST_PRACTICE'])
export type RuleCategoryType = z.infer<typeof RuleCategorySchema>

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

// Match trace entry (per JDRuleChunk)
export const MatchTraceEntrySchema = z.object({
  ruleId: z.string().uuid(),
  ruleChunkId: z.string().uuid(),
  ruleChunkContent: z.string(),
  candidates: z.array(MatchCandidateSchema),
  bestCandidate: MatchCandidateSchema.nullable(),
  judgeUsed: z.boolean(),
  judgeSkipped: z.boolean(),
  judgeResult: z
    .object({
      relevant: z.boolean(),
      reason: z.string(),
      confidence: z.enum(['low', 'medium', 'high']).optional(),
    })
    .nullable(),
  satisfied: z.boolean(),
})

// Gap
export const GapSchema = z.object({
  jdId: z.string().uuid(),
  ruleId: z.string().uuid(),
  ruleChunkId: z.string().uuid(),
  ruleType: RuleCategorySchema,
  content: z.string(),
  reason: z.string(),
})

// Suggestion
export const SuggestionSchema = z.object({
  suggestionId: z.string(),
  ruleId: z.string().uuid(),
  ruleChunkId: z.string().uuid(),
  ruleType: RuleCategorySchema,
  message: z.string(),
  target: z.enum(['cv', 'project', 'skills', 'experience', 'education']),
  relatedCvChunkId: z.string().uuid().optional(),
})

// JD Match Result
export const JdMatchResultSchema = z.object({
  level: JdMatchLevelSchema,
  matchTrace: z.array(MatchTraceEntrySchema),
  gaps: z.array(GapSchema),
  suggestions: z.array(SuggestionSchema),
  scores: z.object({
    mustCoverage: z.number(),
    niceCoverage: z.number(),
    bestCoverage: z.number(),
    totalScore: z.number(),
  }),
})

// Trace/Audit metadata
export const TraceMetadataSchema = z.object({
  requestId: z.string().uuid(),
  cvId: z.string().uuid(),
  jdId: z.string().uuid().optional(),
  stopReason: z.string().optional(),
  ruleSetVersion: z.string(),
  embedding: z.object({
    provider: z.string(),
    model: z.string(),
    dimension: z.number().int(),
  }),
  matching: z.object({
    topK: z.number().int(),
    thresholds: z.object({
      floor: z.number(),
      low: z.number(),
      high: z.number(),
    }),
  }),
  timingsMs: z.object({
    cvQuality: z.number().optional(),
    cvEmbedding: z.number().optional(),
    jdEmbedding: z.number().optional(),
    jdMatching: z.number().optional(),
    total: z.number(),
  }),
})

// Evaluation Request
export const RunEvaluationBodySchema = z
  .object({
    cvId: z.string().uuid(),
    jdId: z.string().uuid().optional(),
  })
  .strict()

// Evaluation Response
export const EvaluationResultSchema = z.object({
  cvQuality: CvQualityResultSchema,
  jdMatch: JdMatchResultSchema.optional(),
  trace: TraceMetadataSchema,
})
