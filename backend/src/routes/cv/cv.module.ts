import { Module } from '@nestjs/common'
import { CvController } from './cv.controller'
import { CvService } from './cv.service'
import { CvRepo } from './cv.repo'

@Module({
  controllers: [CvController],
  providers: [CvService, CvRepo],
  exports: [CvService, CvRepo],
})
export class CvModule {}
