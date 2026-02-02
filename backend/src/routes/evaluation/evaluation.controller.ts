import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common'
import { Auth } from 'src/shared/decorators/auth.decorator'
import { ActiveUser } from 'src/shared/decorators/active.user.decorator'
import { AuthType } from 'src/shared/constants/auth.constant'
import { EvaluationService } from './evaluation.service'
import { RunEvaluationBodyDTO, type EvaluationResultDTO } from './evaluation.dto'
import type { AccessTokenPayload } from 'src/shared/types/jwt.type'

@Controller('evaluation')
export class EvaluationController {
  constructor(private readonly evaluationService: EvaluationService) {}

  @Post('run')
  @Auth([AuthType.Bearer])
  @HttpCode(HttpStatus.OK)
  async runEvaluation(
    @ActiveUser() user: AccessTokenPayload,
    @Body() body: RunEvaluationBodyDTO,
  ): Promise<EvaluationResultDTO> {
    return await this.evaluationService.runEvaluation(String(user.userId), body.cvId, body.jdId)
  }
}
