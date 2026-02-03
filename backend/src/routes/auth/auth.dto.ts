import { createZodDto } from 'nestjs-zod'
import {
  RegisterBodySchema,
  RegisterResponseSchema,
  ResendVerificationEmailBodySchema,
  ResendVerificationEmailResponseSchema,
  VerifyEmailCodeBodySchema,
  VerifyEmailCodeResponseSchema,
  LoginBodySchema,
  LoginResponseSchema,
  RefreshTokenBodySchema,
  RefreshTokenResponseSchema,
  RefreshTokenSchema,
  ForgotPasswordBodySchema,
  ForgotPasswordResponseSchema,
  ResetPasswordBodySchema,
  ResetPasswordResponseSchema,
} from './auth.model'

export class RegisterBodyDTO extends createZodDto(RegisterBodySchema) {}
export class RegisterResponseDTO extends createZodDto(RegisterResponseSchema) {}
export class ResendVerificationEmailBodyDTO extends createZodDto(ResendVerificationEmailBodySchema) {}
export class ResendVerificationEmailResponseDTO extends createZodDto(ResendVerificationEmailResponseSchema) {}
export class VerifyEmailBodyDTO extends createZodDto(VerifyEmailCodeBodySchema) {}
export class VerifyEmailResponseDTO extends createZodDto(VerifyEmailCodeResponseSchema) {}
export class LoginBodyDTO extends createZodDto(LoginBodySchema) {}
export class LoginResponseDTO extends createZodDto(LoginResponseSchema) {}
export class RefreshTokenBodyDTO extends createZodDto(RefreshTokenBodySchema) {}
export class RefreshTokenResponseDTO extends createZodDto(RefreshTokenResponseSchema) {}
export class RefreshTokenDTO extends createZodDto(RefreshTokenSchema) {}
export class ForgotPasswordBodyDTO extends createZodDto(ForgotPasswordBodySchema) {}
export class ForgotPasswordResponseDTO extends createZodDto(ForgotPasswordResponseSchema) {}
export class ResetPasswordBodyDTO extends createZodDto(ResetPasswordBodySchema) {}
export class ResetPasswordResponseDTO extends createZodDto(ResetPasswordResponseSchema) {}
