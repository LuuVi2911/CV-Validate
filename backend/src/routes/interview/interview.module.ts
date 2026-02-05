import { Module } from '@nestjs/common'
import { InterviewController } from './interview.controller'
import { InterviewService } from './interview.service'
import { SharedModule } from 'src/shared/shared.module'
import { CvModule } from '../cv/cv.module'
import { JdModule } from '../jd/jd.module'

@Module({
    imports: [SharedModule, CvModule, JdModule],
    controllers: [InterviewController],
    providers: [InterviewService],
})
export class InterviewModule { }
