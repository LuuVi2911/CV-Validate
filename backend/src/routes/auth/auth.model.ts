import z from 'zod'
import { UserSchema } from 'src/shared/model/share-user.model'

export const RegisterBodySchema = UserSchema.pick({
  email: true,
  password: true,
})
  .extend({
    confirmPassword: z.string().min(8).max(32),
    code: z.string().length(6),
  })
  .strict()
  .superRefine(({ confirmPassword, password }, ctx) => {
    if (confirmPassword !== password) {
      ctx.addIssue({
        code: 'custom',
        message: 'Password and confirm password must match',
        path: ['confirmPassword'],
      })
    }
  })

export const RegisterResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  emailVerified: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  deletedAt: z.coerce.date().nullable(),
})

export const SendVerificationEmailBodySchema = z
  .object({
    email: z.string().email(),
    type: z.enum(['EMAIL_VERIFICATION', 'FORGOT_PASSWORD']),
  })
  .strict()

export const SendVerificationEmailResponseSchema = z.object({
  message: z.string(),
})

export const LoginBodySchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

export const LoginResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
})

export const RefreshTokenBodySchema = z
  .object({
    refreshToken: z.string(),
  })
  .strict()

export const RefreshTokenResponseSchema = LoginResponseSchema

export const RefreshTokenSchema = z.object({
  id: z.string(),
  userId: z.string(),
  token: z.string(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
})

export const ForgotPasswordBodySchema = z
  .object({
    email: z.string().email(),
  })
  .strict()

export const ForgotPasswordResponseSchema = z.object({
  message: z.string(),
})

export const VerifyEmailCodeBodySchema = z
  .object({
    email: z.string().email(),
    code: z.string().min(6).max(6),
  })
  .strict()

export const VerifyEmailCodeResponseSchema = z.object({
  message: z.string(),
  verified: z.boolean(),
})

export const ResetPasswordBodySchema = z
  .object({
    email: z.string().email(),
    code: z.string().min(6).max(6),
    newPassword: z.string().min(8).max(32),
    confirmPassword: z.string().min(8).max(32),
  })
  .strict()
  .superRefine(({ confirmPassword, newPassword }, ctx) => {
    if (confirmPassword !== newPassword) {
      ctx.addIssue({
        code: 'custom',
        message: 'New password and confirm password must match',
        path: ['confirmPassword'],
      })
    }
  })

export const ResetPasswordResponseSchema = z.object({
  message: z.string(),
})

export const UpdatePasswordBodySchema = z
  .object({
    currentPassword: z.string(),
    newPassword: z.string().min(8).max(32),
    confirmPassword: z.string().min(8).max(32),
  })
  .strict()
  .superRefine(({ confirmPassword, newPassword }, ctx) => {
    if (confirmPassword !== newPassword) {
      ctx.addIssue({
        code: 'custom',
        message: 'New password and confirm password must match',
        path: ['confirmPassword'],
      })
    }
  })

export const UpdatePasswordResponseSchema = z.object({
  message: z.string(),
})

export const SendPasswordUpdateVerificationBodySchema = z
  .object({
    email: z.string().email(),
  })
  .strict()

export const SendPasswordUpdateVerificationResponseSchema = z.object({
  message: z.string(),
})

export const VerifyPasswordUpdateCodeBodySchema = z
  .object({
    email: z.string().email(),
    code: z.string().min(6).max(6),
    newPassword: z.string().min(8).max(32),
    confirmPassword: z.string().min(8).max(32),
  })
  .strict()
  .superRefine(({ confirmPassword, newPassword }, ctx) => {
    if (confirmPassword !== newPassword) {
      ctx.addIssue({
        code: 'custom',
        message: 'New password and confirm password must match',
        path: ['confirmPassword'],
      })
    }
  })

export const VerifyPasswordUpdateCodeResponseSchema = z.object({
  message: z.string(),
})
