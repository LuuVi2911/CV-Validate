import { NestFactory } from '@nestjs/core'
import * as fs from 'fs'
import * as path from 'path'
import { AppModule } from '../app.module'
import { RuleIngestionService } from '../shared/services/rule-ingestion.service'

/**
 * CLI script to ingest and embed CV quality rules from PDF into the database.
 *
 * Usage (from backend folder):
 *   npx ts-node -r tsconfig-paths/register src/scripts/ingest-cv-quality-rules.ts
 *
 * Requirements:
 * - PostgreSQL with pgvector installed
 * - GEMINI_API_KEY and EMBEDDING_MODEL configured in .env
 * - "Rule For Student.pdf" present in src/rules/student-fresher
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'error', 'warn'],
  })

  try {
    const ruleIngestionService = app.get(RuleIngestionService)

    // Path to the CV quality rules PDF
    const pdfPath = path.resolve(__dirname, '../rules/student-fresher/Rule For Student.pdf')

    if (!fs.existsSync(pdfPath)) {
      console.error(`PDF file not found at: ${pdfPath}`)
      process.exitCode = 1
      return
    }

    const buffer = fs.readFileSync(pdfPath)

    // Rule set key and version - version derived from file modification date
    const ruleSetKey = 'cv-quality-student-fresher'
    const version = new Date(fs.statSync(pdfPath).mtime).toISOString().slice(0, 10) // YYYY-MM-DD

    console.log(`Ingesting CV quality rules from PDF: ${pdfPath}`)
    console.log(`RuleSet key: ${ruleSetKey}, version: ${version}`)

    const result = await ruleIngestionService.ingestFromPdf(buffer, ruleSetKey, path.basename(pdfPath), version)

    console.log('Ingestion completed:')
    console.log(`- RuleSet ID: ${result.ruleSetId}`)
    console.log(`- Rules created: ${result.rulesCreated}`)
    console.log(`- Chunks created: ${result.chunksCreated}`)
    console.log(`- Chunks embedded: ${result.chunksEmbedded}`)
  } catch (error) {
    console.error('Error during CV quality rule ingestion:', error)
    process.exitCode = 1
  } finally {
    await app.close()
  }
}

bootstrap()
