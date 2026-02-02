import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { Auth } from 'src/shared/decorators/auth.decorator'
import { AuthType } from 'src/shared/constants/auth.constant'
import { AuthService } from './auth.service'
import {
  RegisterBodyDTO,
  RegisterResponseDTO,
  SendVerificationEmailBodyDTO,
  SendVerificationEmailResponseDTO,
  LoginBodyDTO,
  LoginResponseDTO,
  RefreshTokenBodyDTO,
  RefreshTokenResponseDTO,
  ForgotPasswordBodyDTO,
  ForgotPasswordResponseDTO,
  ResetPasswordBodyDTO,
  ResetPasswordResponseDTO,
} from './auth.dto'
import {
  InvalidOTPException,
  OTPExpiredException,
  EmailNotFoundException,
  RefreshTokenAlreadyUsedException,
  FailedToSendOTPException,
} from './auth.error'
import { VerificationCodeType } from 'src/shared/constants/auth.constant'

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('send-verification-email')
  @Auth([AuthType.None])
  @HttpCode(HttpStatus.OK)
  async sendVerificationEmail(@Body() body: SendVerificationEmailBodyDTO): Promise<SendVerificationEmailResponseDTO> {
    try {
      return await this.authService.sendOTP(body.email, body.type as VerificationCodeType)
    } catch (err) {
      if (err instanceof Error && err.message.includes('send')) {
        throw FailedToSendOTPException
      }
      throw err
    }
  }

  @Post('register')
  @Auth([AuthType.None])
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() body: RegisterBodyDTO): Promise<RegisterResponseDTO> {
    try {
      return await this.authService.register(body.email, body.password, body.code)
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === 'Email not sent OTP') {
          throw new UnprocessableEntityException([{ message: 'Error.EmailNotSentOTP', path: 'email' }])
        }
        if (err.message === 'OTP is invalid or expired') throw OTPExpiredException
        if (err.message === 'OTP is incorrect') throw InvalidOTPException
      }
      throw err
    }
  }

  @Post('login')
  @Auth([AuthType.None])
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: LoginBodyDTO): Promise<LoginResponseDTO> {
    try {
      return await this.authService.login(body.email, body.password)
    } catch (err) {
      if (err instanceof Error && err.message === 'Email or password is incorrect') {
        throw new UnauthorizedException('Error.InvalidCredentials')
      }
      throw err
    }
  }

  @Post('refresh')
  @Auth([AuthType.None])
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: RefreshTokenBodyDTO): Promise<RefreshTokenResponseDTO> {
    try {
      return await this.authService.refreshToken(body.refreshToken)
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === 'Refresh token already used') throw RefreshTokenAlreadyUsedException
        if (err.message === 'User not found') {
          throw new UnauthorizedException('Error.UnauthorizedAccess')
        }
      }
      throw err
    }
  }

  @Post('logout')
  @Auth([AuthType.None])
  @HttpCode(HttpStatus.OK)
  async logout(@Body() body: RefreshTokenBodyDTO) {
    return await this.authService.logout(body.refreshToken)
  }

  @Post('forgot-password')
  @Auth([AuthType.None])
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() body: ForgotPasswordBodyDTO): Promise<ForgotPasswordResponseDTO> {
    try {
      await this.authService.sendOTP(body.email, VerificationCodeType.FORGOT_PASSWORD)
      return { message: 'OTP sent successfully' }
    } catch (err) {
      if (err instanceof Error && err.message.includes('send')) {
        throw FailedToSendOTPException
      }
      throw err
    }
  }

  @Post('reset-password')
  @Auth([AuthType.None])
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() body: ResetPasswordBodyDTO): Promise<ResetPasswordResponseDTO> {
    try {
      return await this.authService.forgotPassword(body.email, body.code, body.newPassword)
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === 'Email not found') throw EmailNotFoundException
        if (err.message === 'OTP is invalid or expired') throw OTPExpiredException
        if (err.message === 'OTP is incorrect') throw InvalidOTPException
      }
      throw err
    }
  }
}
