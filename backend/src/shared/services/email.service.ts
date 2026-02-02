import { Injectable } from '@nestjs/common'
import { Resend } from 'resend'
import envConfig from '../config'
import { VerificationCodeType } from '../constants/auth.constant'

@Injectable()
export class EmailService {
  private resend: Resend
  private readonly fromEmail: string

  constructor() {
    this.resend = new Resend(envConfig.RESEND_API_KEY)
    // You can set this from env or use a default
    this.fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
  }

  /**
   * Sends an OTP code via email
   * @param email Recipient email address
   * @param otpCode The 6-digit OTP code
   * @param type Type of verification (EMAIL_VERIFICATION or FORGOT_PASSWORD)
   */
  async sendOTPCode(email: string, otpCode: string, type: VerificationCodeType): Promise<void> {
    const { subject, html } = this.getEmailTemplate(otpCode, type)

    await this.resend.emails.send({
      from: this.fromEmail,
      to: email,
      subject,
      html,
    })
  }

  /**
   * Gets the appropriate email template based on verification type
   */
  private getEmailTemplate(otpCode: string, type: VerificationCodeType): { subject: string; html: string } {
    if (type === 'FORGOT_PASSWORD') {
      return {
        subject: 'Reset Your Password - Verification Code',
        html: this.getForgotPasswordTemplate(otpCode),
      }
    }

    return {
      subject: 'Verify Your Email Address',
      html: this.getEmailVerificationTemplate(otpCode),
    }
  }

  /**
   * HTML template for email verification
   */
  private getEmailVerificationTemplate(otpCode: string): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify Your Email</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f4;">
    <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
            <td style="padding: 40px 20px;">
                <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <tr>
                        <td style="padding: 40px 30px; text-align: center;">
                            <h1 style="margin: 0 0 20px 0; color: #333333; font-size: 28px; font-weight: 600;">
                                Verify Your Email Address
                            </h1>
                            <p style="margin: 0 0 30px 0; color: #666666; font-size: 16px; line-height: 1.6;">
                                Thank you for signing up! Please use the verification code below to verify your email address.
                            </p>
                            <div style="background-color: #f8f9fa; border: 2px dashed #dee2e6; border-radius: 8px; padding: 30px; margin: 30px 0;">
                                <div style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #007bff; font-family: 'Courier New', monospace;">
                                    ${otpCode}
                                </div>
                            </div>
                            <p style="margin: 30px 0 0 0; color: #999999; font-size: 14px; line-height: 1.5;">
                                This code will expire in 10 minutes. If you didn't request this code, please ignore this email.
                            </p>
                        </td>
                    </tr>
                </table>
                <table role="presentation" style="max-width: 600px; margin: 20px auto 0;">
                    <tr>
                        <td style="text-align: center; padding: 20px; color: #999999; font-size: 12px;">
                            <p style="margin: 0;">This is an automated message, please do not reply.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
    `.trim()
  }

  /**
   * HTML template for forgot password
   */
  private getForgotPasswordTemplate(otpCode: string): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reset Your Password</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f4;">
    <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
            <td style="padding: 40px 20px;">
                <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <tr>
                        <td style="padding: 40px 30px; text-align: center;">
                            <h1 style="margin: 0 0 20px 0; color: #333333; font-size: 28px; font-weight: 600;">
                                Reset Your Password
                            </h1>
                            <p style="margin: 0 0 30px 0; color: #666666; font-size: 16px; line-height: 1.6;">
                                We received a request to reset your password. Use the verification code below to proceed with resetting your password.
                            </p>
                            <div style="background-color: #fff3cd; border: 2px dashed #ffc107; border-radius: 8px; padding: 30px; margin: 30px 0;">
                                <div style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #856404; font-family: 'Courier New', monospace;">
                                    ${otpCode}
                                </div>
                            </div>
                            <p style="margin: 30px 0 0 0; color: #999999; font-size: 14px; line-height: 1.5;">
                                This code will expire in 10 minutes. If you didn't request a password reset, please ignore this email and your password will remain unchanged.
                            </p>
                        </td>
                    </tr>
                </table>
                <table role="presentation" style="max-width: 600px; margin: 20px auto 0;">
                    <tr>
                        <td style="text-align: center; padding: 20px; color: #999999; font-size: 12px;">
                            <p style="margin: 0;">This is an automated message, please do not reply.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
    `.trim()
  }
}
