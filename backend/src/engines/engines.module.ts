import { Module } from '@nestjs/common'
import { CvQualityEngine } from './cv-quality/cv-quality.engine'
import { JdMatchingEngine } from './jd-matching/jd-matching.engine'
import { CvModule } from 'src/routes/cv/cv.module'
import { JdModule } from 'src/routes/jd/jd.module'

@Module({
  imports: [CvModule, JdModule],
  providers: [CvQualityEngine, JdMatchingEngine],
  exports: [CvQualityEngine, JdMatchingEngine],
})
export class EnginesModule {}
