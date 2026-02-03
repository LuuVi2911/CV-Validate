import { Injectable } from '@nestjs/common'
import { OAuth2Client } from 'google-auth-library'
import { google } from 'googleapis'
import { createHash } from 'crypto'
import { AuthRepo } from 'src/routes/auth/auth.repo'
import { AuthService } from 'src/routes/auth/auth.service'
import { GoogleUserInfoError } from 'src/routes/auth/auth.error'
import envConfig from 'src/shared/config'
import { HashingService } from 'src/shared/services/hashing.service'
import { v4 as uuidv4 } from 'uuid'

@Injectable()
export class GoogleService {
  private oauth2Client: OAuth2Client

  constructor(
    private readonly authRepo: AuthRepo,
    private readonly hashingService: HashingService,
    private readonly authService: AuthService,
  ) {
    this.oauth2Client = new google.auth.OAuth2(
      envConfig.GOOGLE_CLIENT_ID,
      envConfig.GOOGLE_CLIENT_SECRET,
      envConfig.GOOGLE_REDIRECT_URI,
    )
  }

  getAuthorizationUrl() {
    const scope = ['https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/userinfo.email']

    const url = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope,
      include_granted_scopes: true,
    })

    return { url }
  }

  async googleCallback({ code }: { code: string }) {
    // 1. Exchange code for tokens
    const { tokens } = await this.oauth2Client.getToken(code)
    this.oauth2Client.setCredentials(tokens)

    // 2. Get Google user info
    const oauth2 = google.oauth2({
      auth: this.oauth2Client,
      version: 'v2',
    })

    const { data } = await oauth2.userinfo.get()
    if (!data.email) {
      throw GoogleUserInfoError
    }

    // 3. Find or create user
    let user = await this.authRepo.findUserByEmail(data.email)

    if (!user) {
      const randomPassword = uuidv4()
      const hashedPassword = await this.hashingService.hash(randomPassword)

      await this.authRepo.createUser({
        email: data.email,
        password: hashedPassword,
      })

      // Get the full user after creation
      user = await this.authRepo.findUserByEmail(data.email)
      if (!user) {
        throw new Error('Failed to create user')
      }
    }

    // 4. Convert string userId to number for JWT payload
    const hash = createHash('sha256').update(user.id).digest('hex')
    const userIdNumber = parseInt(hash.substring(0, 8), 16) % 2147483647

    // 5. Generate auth tokens
    return this.authService.generateTokens(
      {
        userId: userIdNumber,
        userUuid: user.id,
        deviceId: 0,
        roleId: 0,
        roleName: 'user',
      },
      user.id, // Pass the user's string UUID for database operations
    )
  }
}
