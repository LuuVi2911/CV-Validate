import { Injectable } from '@nestjs/common'
import { OAuth2Client } from 'google-auth-library'
import { google } from 'googleapis'
import { AuthRepository } from 'src/routes/auth/auth.repo'
import { AuthService } from 'src/routes/auth/auth.service'
import { GoogleUserInfoError } from 'src/routes/auth/auth.error'
import envConfig from 'src/shared/config'
import { HashingService } from 'src/shared/services/hashing.service'
import { v4 as uuidv4 } from 'uuid'

@Injectable()
export class GoogleService {
  private oauth2Client: OAuth2Client

  constructor(
    private readonly authRepository: AuthRepository,
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
    let user = await this.authRepository.findUniqueUser({
      email: data.email,
    })

    if (!user) {
      const randomPassword = uuidv4()
      const hashedPassword = await this.hashingService.hash(randomPassword)

      user = await this.authRepository.createUser({
        email: data.email,
        name: data.name ?? '',
        password: hashedPassword,
        phoneNumber: '',
        avatar: data.picture ?? null,
      })
    }

    // 4. Generate auth tokens
    return this.authService.generateTokens({
      userId: user.id,
    })
  }
}
