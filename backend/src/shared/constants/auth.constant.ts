export const REQUEST_USER_KEY = 'user'

export const AuthType = {
  Bearer: 'Bearer',
  None: 'None',
  APIKey: 'ApiKey',
} as const

export type AuthTypeType = (typeof AuthType)[keyof typeof AuthType]

export const ConditionGuard = {
  And: 'and',
  Or: 'or',
} as const

export type ConditionGuardType = (typeof ConditionGuard)[keyof typeof ConditionGuard]

// Re-export VerificationCodeType from Prisma
export { VerificationCodeType } from '../../generated/prisma/enums'
export type { VerificationCodeType as VerificationCodeTypeType } from '../../generated/prisma/enums'
