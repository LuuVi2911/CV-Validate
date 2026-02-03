import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'
import { PrismaService } from '../shared/services/prisma.service'
import { EmbeddingService } from '../shared/services/embedding.service'

/**
 * CLI script to embed JD matching rules (JDRuleChunk) into the database.
 *
 * Usage (from backend folder):
 *   # Embed rules for ALL job descriptions
 *   npx ts-node -r tsconfig-paths/register src/scripts/embed-jd-rules.ts
 *
 *   # Embed rules for a specific JD only
 *   npx ts-node -r tsconfig-paths/register src/scripts/embed-jd-rules.ts <jdId>
 *
 * Requirements:
 * - PostgreSQL with pgvector installed
 * - GEMINI_API_KEY and EMBEDDING_MODEL configured in .env
 * - JDRule/JDRuleChunk rows already created by jd-rule-extraction.service
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'error', 'warn'],
  })

  try {
    const prisma = app.get(PrismaService)
    const embeddingService = app.get(EmbeddingService)

    const jdIdArg = process.argv[2]

    if (!embeddingService.isEnabled()) {
      console.error('EmbeddingService is not enabled (missing GEMINI_API_KEY). Aborting.')
      process.exitCode = 1
      return
    }

    if (jdIdArg) {
      // Embed for a single JD
      console.log(`Embedding JD rule chunks for JD: ${jdIdArg}`)
      const result = await embeddingService.embedJdRuleChunks(jdIdArg)
      console.log(`JD ${jdIdArg}: embedded=${result.embedded}, skipped=${result.skipped}`)
    } else {
      // Embed for all JDs
      const jds = await prisma.jobDescription.findMany({
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      })

      console.log(`Found ${jds.length} job descriptions.`)

      let totalEmbedded = 0
      let totalSkipped = 0

      for (const jd of jds) {
        console.log(`Embedding JD rule chunks for JD: ${jd.id}`)
        const result = await embeddingService.embedJdRuleChunks(jd.id)
        console.log(`  → embedded=${result.embedded}, skipped=${result.skipped}`)
        totalEmbedded += result.embedded
        totalSkipped += result.skipped
      }

      console.log('JD embedding completed:')
      console.log(`- Total embedded: ${totalEmbedded}`)
      console.log(`- Total skipped (already embedded): ${totalSkipped}`)
    }
  } catch (error) {
    console.error('Error during JD rule embedding:', error)
    process.exitCode = 1
  } finally {
    await app.close()
  }
}

bootstrap()
