import { Module } from '@nestjs/common'
import { EvaluationController } from './evaluation.controller'
import { EvaluationService } from './evaluation.service'
import { CvModule } from '../cv/cv.module'
import { JdModule } from '../jd/jd.module'
import { EnginesModule } from 'src/engines/engines.module'

@Module({
  imports: [CvModule, JdModule, EnginesModule],
  controllers: [EvaluationController],
  providers: [EvaluationService],
})
export class EvaluationModule {}
