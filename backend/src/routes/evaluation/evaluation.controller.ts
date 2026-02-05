import { Controller, Post, Get, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common'
import { Auth } from 'src/shared/decorators/auth.decorator'
import { ActiveUser } from 'src/shared/decorators/active.user.decorator'
import { AuthType } from 'src/shared/constants/auth.constant'
import { EvaluationService } from './evaluation.service'
import { RunEvaluationBodyDTO, type EvaluationResultDTO, type EvaluationSummaryDTO } from './evaluation.dto'
import type { AccessTokenPayload } from 'src/shared/types/jwt.type'

@Controller('evaluation')
export class EvaluationController {
  constructor(private readonly evaluationService: EvaluationService) { }

  @Post('run')
  @Auth([AuthType.Bearer])
  @HttpCode(HttpStatus.OK)
  async runEvaluation(
    @ActiveUser() user: AccessTokenPayload,
    @Body() body: RunEvaluationBodyDTO,
  ): Promise<EvaluationResultDTO> {
    return await this.evaluationService.runEvaluation(user.userUuid, body.cvId, body.jdId)
  }

  @Get('list')
  @Auth([AuthType.Bearer])
  @HttpCode(HttpStatus.OK)
  async listEvaluations(@ActiveUser() user: AccessTokenPayload) {
    return await this.evaluationService.listEvaluations(user.userUuid)
  }

  @Get(':id/summary')
  @Auth([AuthType.Bearer])
  @HttpCode(HttpStatus.OK)
  async getEvaluationSummary(
    @ActiveUser() user: AccessTokenPayload,
    @Param('id') evaluationId: string,
  ): Promise<EvaluationSummaryDTO> {
    return await this.evaluationService.getEvaluationSummary(user.userUuid, evaluationId)
  }

  @Delete(':id')
  @Auth([AuthType.Bearer])
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteEvaluation(
    @ActiveUser() user: AccessTokenPayload,
    @Param('id') evaluationId: string,
  ): Promise<void> {
    await this.evaluationService.deleteEvaluation(user.userUuid, evaluationId)
  }
}
