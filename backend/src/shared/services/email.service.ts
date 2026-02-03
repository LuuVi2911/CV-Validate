import { Injectable } from '@nestjs/common'
import { Resend } from 'resend'
import envConfig from '../config'
import { VerificationCodeType } from '../constants/auth.constant'
import fs from 'fs'
import path from 'path'

@Injectable()
export class EmailService {
  private resend: Resend
  private readonly fromEmail: string

  constructor() {
    this.resend = new Resend(envConfig.RESEND_API_KEY)
    // You can set this from env or use a default
    this.fromEmail = process.env.RESEND_FROM_EMAIL || 'CV Enhancer <onboarding@resend.dev>'
  }

  /**
   * Sends an OTP code via email
   * @param email Recipient email address
   * @param otpCode The 6-digit OTP code
   * @param type Type of verification (EMAIL_VERIFICATION or FORGOT_PASSWORD)
   */
  async sendOTPCode(email: string, otpCode: string, type: VerificationCodeType): Promise<void> {
    const subject = this.getEmailSubject(type)
    let html: string

    // If reading / rendering the template fails, log it explicitly (otherwise it looks like "EmailService wasn't called").
    try {
      html = this.renderOtpHtml({ otpCode, title: subject, type })
    } catch (err) {
      const error = err as any
      console.error('[EmailService] Failed to render otp.html', {
        to: email,
        from: this.fromEmail,
        subject,
        name: error?.name,
        message: error?.message,
      })
      throw err
    }

    // Resend SDK returns { data, error } (it may not throw). Handle + log both cases.
    try {
      const result = await this.resend.emails.send({
        from: this.fromEmail,
        to: [email],
        subject,
        html,
      })

      const resendError = (result as any)?.error
      if (resendError) {
        console.error('[EmailService] Resend send error', {
          to: email,
          from: this.fromEmail,
          subject,
          statusCode: resendError?.statusCode,
          message: resendError?.message,
          name: resendError?.name,
        })
        throw new Error(`send failed: ${resendError?.message ?? 'unknown resend error'}`)
      }
    } catch (err) {
      // Helpful debug logging (avoid printing secrets)
      const error = err as any
      console.error('[EmailService] Resend send threw', {
        to: email,
        from: this.fromEmail,
        subject,
        name: error?.name,
        message: error?.message,
        statusCode: error?.statusCode,
        details: error?.details,
        response: error?.response,
      })
      throw err
    }
  }

  /**
   * Gets the appropriate email subject based on verification type
   */
  private getEmailSubject(type: VerificationCodeType): string {
    if (type === 'FORGOT_PASSWORD') {
      return 'Reset Your Password - Verification Code'
    }

    return 'Verify Your Email Address'
  }

  private renderOtpHtml(payload: { otpCode: string; title: string; type: VerificationCodeType }): string {
    const templatePath = path.resolve(process.cwd(), 'emails', 'otp.html')
    const template = fs.readFileSync(templatePath, 'utf8')

    const isForgot = payload.type === 'FORGOT_PASSWORD'
    const message = isForgot
      ? 'We received a request to reset your password. Use the verification code below to proceed with resetting your password.'
      : 'Thank you for signing up! Please use the verification code below to verify your email address.'

    const accentColor = isForgot ? '#856404' : '#007bff'
    const boxBg = isForgot ? '#fff3cd' : '#f8f9fa'
    const borderColor = isForgot ? '#ffc107' : '#dee2e6'
    const footer = isForgot
      ? "This code will expire in 10 minutes. If you didn't request a password reset, please ignore this email and your password will remain unchanged."
      : "This code will expire in 10 minutes. If you didn't request this code, please ignore this email."

    return template
      .replaceAll('{{title}}', payload.title)
      .replaceAll('{{message}}', message)
      .replaceAll('{{otpCode}}', payload.otpCode)
      .replaceAll('{{accentColor}}', accentColor)
      .replaceAll('{{boxBg}}', boxBg)
      .replaceAll('{{borderColor}}', borderColor)
      .replaceAll('{{footer}}', footer)
  }
}
