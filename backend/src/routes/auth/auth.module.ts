import { Module } from '@nestjs/common'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { AuthRepo } from './auth.repo'
import { HashingService } from 'src/shared/services/hashing.service'

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepo, HashingService],
})
export class AuthModule {}
