import { Module } from '@nestjs/common'
import { JdController } from './jd.controller'
import { JdService } from './jd.service'
import { JdRepo } from './jd.repo'

@Module({
  controllers: [JdController],
  providers: [JdService, JdRepo],
  exports: [JdService, JdRepo],
})
export class JdModule {}
