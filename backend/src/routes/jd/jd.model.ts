import { z } from 'zod'

// Enums
export const RuleTypeSchema = z.enum(['MUST_HAVE', 'NICE_TO_HAVE', 'BEST_PRACTICE'])
export type RuleTypeType = z.infer<typeof RuleTypeSchema>

// JD Create Request
export const CreateJdBodySchema = z
  .object({
    title: z.string().max(255).optional(),
    text: z.string().min(10).max(50000),
  })
  .strict()

// JD Create Response
export const CreateJdResponseSchema = z.object({
  jdId: z.string().uuid(),
})

// JD Rule Chunk
export const JdRuleChunkSchema = z.object({
  id: z.string().uuid(),
  ruleId: z.string().uuid(),
  content: z.string(),
})

// JD Rule
export const JdRuleSchema = z.object({
  id: z.string().uuid(),
  jdId: z.string().uuid(),
  ruleType: RuleTypeSchema,
  content: z.string(),
  chunks: z.array(JdRuleChunkSchema),
})

// JD Detail Response
export const JdDetailResponseSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string().nullable(),
  createdAt: z.coerce.date(),
  rules: z.array(JdRuleSchema),
})

// JD List Item
export const JdListItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  createdAt: z.coerce.date(),
  ruleCount: z.number().int(),
  chunkCount: z.number().int(),
})

export const JdListResponseSchema = z.object({
  jds: z.array(JdListItemSchema),
})
