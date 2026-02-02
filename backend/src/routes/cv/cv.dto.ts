import { createZodDto } from 'nestjs-zod'
import {
  CvUploadResponseSchema,
  CvDetailResponseSchema,
  CvListResponseSchema,
  CvChunkSchema,
  CvSectionSchema,
} from './cv.model'

export class CvUploadResponseDTO extends createZodDto(CvUploadResponseSchema) {}
export class CvDetailResponseDTO extends createZodDto(CvDetailResponseSchema) {}
export class CvListResponseDTO extends createZodDto(CvListResponseSchema) {}
export class CvChunkDTO extends createZodDto(CvChunkSchema) {}
export class CvSectionDTO extends createZodDto(CvSectionSchema) {}
