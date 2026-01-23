import { createZodDto } from 'nestjs-zod'
import { EmptyBodySchema } from 'src/shared/model/request.model'

export class EmptyBodyDTO extends createZodDto(EmptyBodySchema) {}
