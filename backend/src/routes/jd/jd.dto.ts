import { createZodDto } from 'nestjs-zod'
import {
  CreateJdBodySchema,
  CreateJdResponseSchema,
  JdDetailResponseSchema,
  JdListResponseSchema,
  JdRuleSchema,
  JdRuleChunkSchema,
} from './jd.model'

export class CreateJdBodyDTO extends createZodDto(CreateJdBodySchema) {}
export class CreateJdResponseDTO extends createZodDto(CreateJdResponseSchema) {}
export class JdDetailResponseDTO extends createZodDto(JdDetailResponseSchema) {}
export class JdListResponseDTO extends createZodDto(JdListResponseSchema) {}
export class JdRuleDTO extends createZodDto(JdRuleSchema) {}
export class JdRuleChunkDTO extends createZodDto(JdRuleChunkSchema) {}
