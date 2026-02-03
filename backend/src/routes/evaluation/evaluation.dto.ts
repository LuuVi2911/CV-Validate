import { createZodDto } from 'nestjs-zod'
import {
  RunEvaluationBodySchema,
  EvaluationResultSchema,
  CvQualityResultSchema,
  JdMatchResultSchema,
  CvQualityFindingSchema,
  MatchTraceEntrySchema,
  ChunkMatchEvidenceSchema,
  GapSchema,
  SuggestionSchema,
  TraceMetadataSchema,
} from './evaluation.model'

export class RunEvaluationBodyDTO extends createZodDto(RunEvaluationBodySchema) {}
export class EvaluationResultDTO extends createZodDto(EvaluationResultSchema) {}
export class CvQualityResultDTO extends createZodDto(CvQualityResultSchema) {}
export class JdMatchResultDTO extends createZodDto(JdMatchResultSchema) {}
export class CvQualityFindingDTO extends createZodDto(CvQualityFindingSchema) {}
export class MatchTraceEntryDTO extends createZodDto(MatchTraceEntrySchema) {}
export class ChunkMatchEvidenceDTO extends createZodDto(ChunkMatchEvidenceSchema) {}
export class GapDTO extends createZodDto(GapSchema) {}
export class SuggestionDTO extends createZodDto(SuggestionSchema) {}
export class TraceMetadataDTO extends createZodDto(TraceMetadataSchema) {}
