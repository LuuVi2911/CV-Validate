import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { REQUEST_USER_KEY } from 'src/shared/constants/auth.constant'
import { TokenService } from 'src/shared/services/token.service'

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly tokenService: TokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()

    // Try to get token from cookies first, then fall back to Authorization header
    const accessToken = request.cookies?.accessToken || request.headers.authorization?.split(' ')[1]

    if (!accessToken) {
      throw new UnauthorizedException('Error.MissingAccessToken')
    }

    try {
      const decoded = await this.tokenService.verifyAccessToken(accessToken)
      request[REQUEST_USER_KEY] = decoded
      return true
    } catch {
      throw new UnauthorizedException('Error.InvalidAccessToken')
    }
  }
}
