import { createZodDto } from 'nestjs-zod'
import {
  RegisterBodySchema,
  RegisterResponseSchema,
  SendVerificationEmailBodySchema,
  SendVerificationEmailResponseSchema,
  LoginBodySchema,
  LoginResponseSchema,
  RefreshTokenBodySchema,
  RefreshTokenResponseSchema,
  RefreshTokenSchema,
} from './auth.model'

export class RegisterBodyDTO extends createZodDto(RegisterBodySchema) {}
export class RegisterResponseDTO extends createZodDto(RegisterResponseSchema) {}
export class SendVerificationEmailBodyDTO extends createZodDto(SendVerificationEmailBodySchema) {}
export class SendVerificationEmailResponseDTO extends createZodDto(SendVerificationEmailResponseSchema) {}
export class LoginBodyDTO extends createZodDto(LoginBodySchema) {}
export class LoginResponseDTO extends createZodDto(LoginResponseSchema) {}
export class RefreshTokenBodyDTO extends createZodDto(RefreshTokenBodySchema) {}
export class RefreshTokenResponseDTO extends createZodDto(RefreshTokenResponseSchema) {}
export class RefreshTokenDTO extends createZodDto(RefreshTokenSchema) {}
