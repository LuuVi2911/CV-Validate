import { Injectable } from '@nestjs/common'
import { addMinutes } from 'date-fns'
import { PrismaService } from 'src/shared/services/prisma.service'
import { HashingService } from 'src/shared/services/hashing.service'
import { TokenService } from 'src/shared/services/token.service'
import { EmailService } from 'src/shared/services/email.service'
import { VerificationCodeType } from 'src/shared/constants/auth.constant'
import { AccessTokenPayloadCreate } from 'src/shared/types/jwt.type'
import { randomInt, createHash } from 'crypto'

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashingService: HashingService,
    private readonly tokenService: TokenService,
    private readonly emailService: EmailService,
  ) {}

  // ==========================
  // Helpers
  // ==========================
  private generateOTP(): string {
    return randomInt(100000, 999999).toString()
  }

  /**
   * Converts UUID string to number for JWT payload
   * Uses a hash to ensure consistent numeric representation
   */
  private userIdToNumber(userId: string): number {
    const hash = createHash('sha256').update(userId).digest('hex')
    // Take first 8 characters and convert to number (mod to fit in safe integer range)
    return parseInt(hash.substring(0, 8), 16) % 2147483647
  }

  private async validateOTP(userId: string, type: VerificationCodeType, code: string) {
    const record = await this.prisma.emailVerification.findFirst({
      where: {
        userId,
        type,
        used: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!record) {
      throw new Error('OTP is invalid or expired')
    }

    const isMatch = await this.hashingService.compare(code, record.codeHash)
    if (!isMatch) {
      throw new Error('OTP is incorrect')
    }

    await this.prisma.emailVerification.update({
      where: { id: record.id },
      data: { used: true },
    })
  }

  // ==========================
  // Register
  // ==========================
  async register(email: string, password: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user) throw new Error('Email not sent OTP')

    await this.validateOTP(user.id, VerificationCodeType.EMAIL_VERIFICATION, code)

    const hashedPassword = await this.hashingService.hash(password)

    return this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        emailVerified: true,
      },
      omit: { password: true },
    })
  }

  // ==========================
  // Send OTP (Register / Forgot)
  // ==========================
  async sendOTP(email: string, type: VerificationCodeType) {
    let user = await this.prisma.user.findUnique({ where: { email } })

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email,
          password: '',
        },
      })
    }

    const code = this.generateOTP()
    const codeHash = await this.hashingService.hash(code)

    await this.prisma.emailVerification.create({
      data: {
        userId: user.id,
        type,
        codeHash,
        expiresAt: addMinutes(new Date(), 10),
      },
    })

    await this.emailService.sendOTPCode(email, code, type)

    return { message: 'OTP sent successfully' }
  }

  // ==========================
  // Login
  // ==========================
  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user || !user.password) {
      throw new Error('Email or password is incorrect')
    }

    const isMatch = await this.hashingService.compare(password, user.password)
    if (!isMatch) {
      throw new Error('Email or password is incorrect')
    }

    const userIdNumber = this.userIdToNumber(user.id)
    const accessToken = this.tokenService.signAccessToken({
      userId: userIdNumber,
      deviceId: 0,
      roleId: 0,
      roleName: 'user',
    })
    const refreshToken = this.tokenService.signRefreshToken({
      userId: userIdNumber,
    })

    const { exp } = await this.tokenService.verifyRefreshToken(refreshToken)

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        expiresAt: new Date(exp * 1000),
      },
    })

    return { accessToken, refreshToken }
  }

  // ==========================
  // Refresh token
  // ==========================
  async refreshToken(oldToken: string) {
    const payload = await this.tokenService.verifyRefreshToken(oldToken)

    const tokenInDb = await this.prisma.refreshToken.findFirst({
      where: { token: oldToken },
    })

    if (!tokenInDb) {
      throw new Error('Refresh token already used')
    }

    await this.prisma.refreshToken.delete({ where: { id: tokenInDb.id } })

    // Get user to convert userId back to string for database
    const user = await this.prisma.user.findUnique({
      where: { id: tokenInDb.userId },
    })

    if (!user) {
      throw new Error('User not found')
    }

    const userIdNumber = this.userIdToNumber(user.id)
    const accessToken = this.tokenService.signAccessToken({
      userId: userIdNumber,
      deviceId: 0,
      roleId: 0,
      roleName: 'user',
    })
    const refreshToken = this.tokenService.signRefreshToken({
      userId: userIdNumber,
    })

    const { exp } = await this.tokenService.verifyRefreshToken(refreshToken)

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        expiresAt: new Date(exp * 1000),
      },
    })

    return { accessToken, refreshToken }
  }

  // ==========================
  // Logout
  // ==========================
  async logout(refreshToken: string) {
    await this.prisma.refreshToken.deleteMany({
      where: { token: refreshToken },
    })
    return { message: 'Logged out successfully' }
  }

  // ==========================
  // Forgot password
  // ==========================
  async forgotPassword(email: string, code: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user) throw new Error('Email not found')

    await this.validateOTP(user.id, VerificationCodeType.FORGOT_PASSWORD, code)

    const hashedPassword = await this.hashingService.hash(newPassword)

    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    })

    return { message: 'changed password successfully' }
  }

  // ==========================
  // Generate Tokens
  // ==========================
  async generateTokens({ userId, deviceId, roleId, roleName }: AccessTokenPayloadCreate, userStringId: string) {
    const [accessToken, refreshToken] = await Promise.all([
      Promise.resolve(
        this.tokenService.signAccessToken({
          userId,
          deviceId,
          roleId,
          roleName,
        }),
      ),
      Promise.resolve(
        this.tokenService.signRefreshToken({
          userId,
        }),
      ),
    ])
    const decodedRefreshToken = await this.tokenService.verifyRefreshToken(refreshToken)
    await this.prisma.refreshToken.create({
      data: {
        userId: userStringId,
        token: refreshToken,
        expiresAt: new Date(decodedRefreshToken.exp * 1000),
      },
    })
    return { accessToken, refreshToken }
  }
}
