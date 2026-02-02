import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Auth } from 'src/shared/decorators/auth.decorator'
import { ActiveUser } from 'src/shared/decorators/active.user.decorator'
import { AuthType } from 'src/shared/constants/auth.constant'
import { CvService } from './cv.service'
import type { CvUploadResponseDTO, CvDetailResponseDTO, CvListResponseDTO } from './cv.dto'
import type { AccessTokenPayload } from 'src/shared/types/jwt.type'

@Controller('cv')
export class CvController {
  constructor(private readonly cvService: CvService) {}

  @Post('upload')
  @Auth([AuthType.Bearer])
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  async uploadCv(
    @ActiveUser() user: AccessTokenPayload,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }), // 10MB
          new FileTypeValidator({ fileType: 'application/pdf' }),
        ],
      }),
    )
    file: Express.Multer.File,
  ): Promise<CvUploadResponseDTO> {
    return await this.cvService.uploadCv(String(user.userId), file)
  }

  @Get()
  @Auth([AuthType.Bearer])
  @HttpCode(HttpStatus.OK)
  async listCvs(@ActiveUser() user: AccessTokenPayload): Promise<CvListResponseDTO> {
    return await this.cvService.listCvs(String(user.userId))
  }

  @Get(':cvId')
  @Auth([AuthType.Bearer])
  @HttpCode(HttpStatus.OK)
  async getCvById(@ActiveUser() user: AccessTokenPayload, @Param('cvId') cvId: string): Promise<CvDetailResponseDTO> {
    return await this.cvService.getCvById(String(user.userId), cvId)
  }

  @Delete(':cvId')
  @Auth([AuthType.Bearer])
  @HttpCode(HttpStatus.OK)
  async deleteCv(@ActiveUser() user: AccessTokenPayload, @Param('cvId') cvId: string) {
    return await this.cvService.deleteCv(String(user.userId), cvId)
  }
}
