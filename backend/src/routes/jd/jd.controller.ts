import { Controller, Get, Post, Delete, Param, Body, HttpCode, HttpStatus } from '@nestjs/common'
import { Auth } from 'src/shared/decorators/auth.decorator'
import { ActiveUser } from 'src/shared/decorators/active.user.decorator'
import { AuthType } from 'src/shared/constants/auth.constant'
import { JdService } from './jd.service'
import { CreateJdBodyDTO, type CreateJdResponseDTO, type JdDetailResponseDTO, type JdListResponseDTO } from './jd.dto'
import type { AccessTokenPayload } from 'src/shared/types/jwt.type'

@Controller('jd')
export class JdController {
  constructor(private readonly jdService: JdService) {}

  @Post()
  @Auth([AuthType.Bearer])
  @HttpCode(HttpStatus.CREATED)
  async createJd(@ActiveUser() user: AccessTokenPayload, @Body() body: CreateJdBodyDTO): Promise<CreateJdResponseDTO> {
    return await this.jdService.createJd(String(user.userId), body.title, body.text)
  }

  @Get()
  @Auth([AuthType.Bearer])
  @HttpCode(HttpStatus.OK)
  async listJds(@ActiveUser() user: AccessTokenPayload): Promise<JdListResponseDTO> {
    return await this.jdService.listJds(String(user.userId))
  }

  @Get(':jdId')
  @Auth([AuthType.Bearer])
  @HttpCode(HttpStatus.OK)
  async getJdById(@ActiveUser() user: AccessTokenPayload, @Param('jdId') jdId: string): Promise<JdDetailResponseDTO> {
    return await this.jdService.getJdById(String(user.userId), jdId)
  }

  @Delete(':jdId')
  @Auth([AuthType.Bearer])
  @HttpCode(HttpStatus.OK)
  async deleteJd(@ActiveUser() user: AccessTokenPayload, @Param('jdId') jdId: string) {
    return await this.jdService.deleteJd(String(user.userId), jdId)
  }
}
