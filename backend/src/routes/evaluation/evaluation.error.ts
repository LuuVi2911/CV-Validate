import { UnprocessableEntityException } from '@nestjs/common'

// Embedding errors
export const EmbeddingDimMismatchException = new UnprocessableEntityException([
  {
    message: 'Error.EmbeddingDimMismatch',
    path: 'embedding',
  },
])

export const MissingEmbeddingsException = new UnprocessableEntityException([
  {
    message: 'Error.MissingEmbeddings',
    path: 'embedding',
  },
])

// Evaluation errors
export const EvaluationFailedException = new UnprocessableEntityException([
  {
    message: 'Error.EvaluationFailed',
    path: 'evaluation',
  },
])
