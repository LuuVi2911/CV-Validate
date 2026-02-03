import { Global, Module } from '@nestjs/common'
import { HashingService } from 'src/shared/services/hashing.service'
import { PrismaService } from 'src/shared/services/prisma.service'
import { TokenService } from 'src/shared/services/token.service'
import { EmailService } from 'src/shared/services/email.service'
import { PdfTextService } from 'src/shared/services/pdf-text.service'
import { CvSectioningService } from 'src/shared/services/cv-sectioning.service'
import { CvChunkingService } from 'src/shared/services/cv-chunking.service'
import { EmbeddingService } from 'src/shared/services/embedding.service'
import { JdRuleExtractionService } from 'src/shared/services/jd-rule-extraction.service'
import { JdRuleChunkingService } from 'src/shared/services/jd-rule-chunking.service'
import { VectorSearchService } from 'src/shared/services/vector-search.service'
import { GeminiJudgeService } from 'src/shared/services/gemini-judge.service'
import { RuleIngestionService } from 'src/shared/services/rule-ingestion.service'
import { AccessTokenGuard } from 'src/shared/guard/access-token.guard'
import { AuthenticationGuard } from 'src/shared/guard/authentication.guard'
import { APP_GUARD } from '@nestjs/core'
import { JwtModule } from '@nestjs/jwt'

const sharedServices = [
  TokenService,
  PrismaService,
  HashingService,
  EmailService,
  PdfTextService,
  CvSectioningService,
  CvChunkingService,
  EmbeddingService,
  JdRuleExtractionService,
  JdRuleChunkingService,
  VectorSearchService,
  GeminiJudgeService,
  RuleIngestionService,
]
@Global()
@Module({
  providers: [
    ...sharedServices,
    AccessTokenGuard,
    {
      provide: APP_GUARD,

      useClass: AuthenticationGuard,
    },
  ],

  exports: [...sharedServices, JwtModule],

  imports: [JwtModule],
})
export class SharedModule {}
