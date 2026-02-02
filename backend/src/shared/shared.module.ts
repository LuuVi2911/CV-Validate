import { Global, Module } from '@nestjs/common'
import { HashingService } from 'src/shared/services/hashing.service'
import { PrismaService } from 'src/shared/services/prisma.service'
import { TokenService } from 'src/shared/services/token.service'
import { EmailService } from 'src/shared/services/email.service'
import { AccessTokenGuard } from 'src/shared/guard/access-token.guard'
import { AuthenticationGuard } from 'src/shared/guard/authentication.guard'
import { APP_GUARD } from '@nestjs/core'
import { JwtModule } from '@nestjs/jwt'

const sharedServices = [TokenService, PrismaService, HashingService, EmailService]
@Global()
@Module({
  providers: [
    ...sharedServices,
    AccessTokenGuard,
    {
      provide: APP_GUARD,

      useClass: AuthenticationGuard,
    },
  ],

  exports: [...sharedServices, JwtModule],

  imports: [JwtModule],
})
export class SharedModule {}
