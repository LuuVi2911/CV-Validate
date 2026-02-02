import { ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common'

// JD not found
export const JdNotFoundException = new NotFoundException('Error.JdNotFound')

// JD not owned by user
export const JdNotOwnedException = new ForbiddenException('Error.JdNotOwned')

// JD text errors
export const JdEmptyTextException = new UnprocessableEntityException([
  {
    message: 'Error.JdEmptyText',
    path: 'text',
  },
])

export const JdNoRulesException = new UnprocessableEntityException([
  {
    message: 'Error.JdNoRules',
    path: 'text',
  },
])

export const JdTextTooLongException = new UnprocessableEntityException([
  {
    message: 'Error.JdTextTooLong',
    path: 'text',
  },
])
