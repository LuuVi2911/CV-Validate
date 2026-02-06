import { Injectable } from '@nestjs/common'
import { InterviewGeneratorService } from 'src/shared/services/interview-generator.service'
import { CvService } from '../cv/cv.service'
import { JdService } from '../jd/jd.service'
import type { MockQuestionType } from '../evaluation/evaluation.model'

@Injectable()
export class InterviewService {
    constructor(
        private readonly interviewGeneratorService: InterviewGeneratorService,
        private readonly cvService: CvService,
        private readonly jdService: JdService,
    ) { }

    async generateQuestions(
        userId: string,
        cvId: string,
        jdId: string,
    ): Promise<{ questions: MockQuestionType[] }> {
        const { sections } = await this.cvService.getCvById(userId, cvId)
        await this.jdService.ensureJdExists(userId, jdId)

        const { rules } = await this.jdService.getJdById(userId, jdId)

        const cvContent = sections.flatMap((s) => s.chunks.map((c) => c.content)).join('\n')
        const jdContent = rules.map((r) => r.content).join('\n')

        const questions = await this.interviewGeneratorService.generateQuestions({
            cvContent,
            jdContent,
        })

        return { questions }
    }
}
