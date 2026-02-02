import { z } from 'zod'

// Enums
export const CvStatusSchema = z.enum(['UPLOADED', 'PARSED', 'EVALUATED'])
export type CvStatusType = z.infer<typeof CvStatusSchema>

export const CvSectionTypeSchema = z.enum(['SUMMARY', 'EXPERIENCE', 'PROJECTS', 'SKILLS', 'EDUCATION', 'ACTIVITIES'])
export type CvSectionTypeType = z.infer<typeof CvSectionTypeSchema>

// CV Upload
export const CvUploadResponseSchema = z.object({
  cvId: z.string().uuid(),
  status: CvStatusSchema,
})

// CV Chunk
export const CvChunkSchema = z.object({
  id: z.string().uuid(),
  sectionId: z.string().uuid(),
  order: z.number().int(),
  content: z.string(),
})

// CV Section
export const CvSectionSchema = z.object({
  id: z.string().uuid(),
  cvId: z.string().uuid(),
  type: CvSectionTypeSchema,
  order: z.number().int(),
  chunks: z.array(CvChunkSchema),
})

// CV Detail Response
export const CvDetailResponseSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  status: CvStatusSchema,
  createdAt: z.coerce.date(),
  sections: z.array(CvSectionSchema),
})

// CV List Item
export const CvListItemSchema = z.object({
  id: z.string().uuid(),
  status: CvStatusSchema,
  createdAt: z.coerce.date(),
  sectionCount: z.number().int(),
  chunkCount: z.number().int(),
})

export const CvListResponseSchema = z.object({
  cvs: z.array(CvListItemSchema),
})
