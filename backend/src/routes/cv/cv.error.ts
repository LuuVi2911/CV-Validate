import { ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common'

// CV not found
export const CvNotFoundException = new NotFoundException('Error.CvNotFound')

// CV not owned by user
export const CvNotOwnedException = new ForbiddenException('Error.CvNotOwned')

// CV parsing errors
export const CvPdfUnreadableException = new UnprocessableEntityException([
  {
    message: 'Error.CvPdfUnreadable',
    path: 'file',
  },
])

export const CvPdfEmptyTextException = new UnprocessableEntityException([
  {
    message: 'Error.CvPdfEmptyText',
    path: 'file',
  },
])

export const CvNoChunksException = new UnprocessableEntityException([
  {
    message: 'Error.CvNoChunks',
    path: 'file',
  },
])

export const CvNotParsedYetException = new UnprocessableEntityException([
  {
    message: 'Error.CvNotParsedYet',
    path: 'cvId',
  },
])

export const CvInvalidFileTypeException = new UnprocessableEntityException([
  {
    message: 'Error.CvInvalidFileType',
    path: 'file',
  },
])

export const CvFileTooLargeException = new UnprocessableEntityException([
  {
    message: 'Error.CvFileTooLarge',
    path: 'file',
  },
])
