import { Controller, Post, Body } from '@nestjs/common'
import { InterviewService } from './interview.service'
import { ActiveUser } from 'src/shared/decorators/active.user.decorator'
import { z } from 'zod'

const GenerateQuestionsBodySchema = z.object({
    cvId: z.string().uuid(),
    jdId: z.string().uuid(),
})

type GenerateQuestionsBody = z.infer<typeof GenerateQuestionsBodySchema>

@Controller('interview')
export class InterviewController {
    constructor(private readonly interviewService: InterviewService) { }

    @Post('generate')
    async generateQuestions(@ActiveUser('userId') userId: string, @Body() body: GenerateQuestionsBody) {
        const { cvId, jdId } = GenerateQuestionsBodySchema.parse(body)
        return this.interviewService.generateQuestions(userId, cvId, jdId)
    }
}
