import { Injectable } from '@nestjs/common'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { PrismaService } from './prisma.service'
import envConfig from '../config'

/**
 * EmbeddingService - Stages 7 & 11
 *
 * Purpose: Generate embeddings for CvChunk and JDRuleChunk rows
 * deterministically and idempotently.
 *
 * Allowed logic:
 * - Idempotency: only embed where embedding IS NULL
 * - Batching + retry policy (deterministic fallbacks)
 * - Dimension validation (vector length must equal DB vector(<dim>))
 *
 * Forbidden logic:
 * - Using embeddings to decide readiness
 * - Similarity thresholds / matching
 */
@Injectable()
export class EmbeddingService {
  private genAI: GoogleGenerativeAI | null = null
  private readonly batchSize = 100

  constructor(private readonly prisma: PrismaService) {
    if (envConfig.GEMINI_API_KEY) {
      this.genAI = new GoogleGenerativeAI(envConfig.GEMINI_API_KEY)
    }
  }

  /**
   * Embed all CvChunks for a CV that don't have embeddings yet
   * Idempotent: only embeds chunks where embedding IS NULL
   */
  async embedCvChunks(cvId: string): Promise<{ embedded: number; skipped: number }> {
    if (!this.genAI) {
      // No API key - skip embedding silently
      return { embedded: 0, skipped: 0 }
    }

    // Find chunks without embeddings.
    // Note: `embedding` is an Unsupported pgvector field, so Prisma can't filter on it.
    const chunks = await this.prisma.$queryRaw<Array<{ id: string; content: string }>>`
      SELECT c.id, c.content
      FROM "CvChunk" c
      JOIN "CvSection" s ON s.id = c."sectionId"
      WHERE s."cvId" = ${cvId}
        AND c.embedding IS NULL
      ORDER BY s."order" ASC, c."order" ASC
    `

    if (chunks.length === 0) {
      return { embedded: 0, skipped: 0 }
    }

    // Process in batches
    let embedded = 0
    for (let i = 0; i < chunks.length; i += this.batchSize) {
      const batch = chunks.slice(i, i + this.batchSize)
      const contents = batch.map((c) => c.content)

      try {
        const embeddings = await this.generateEmbeddings(contents)

        // Validate dimension
        for (const embedding of embeddings) {
          if (embedding.length !== envConfig.EMBEDDING_DIM) {
            throw new Error(
              `Embedding dimension mismatch: expected ${envConfig.EMBEDDING_DIM}, got ${embedding.length}`,
            )
          }
        }

        // Update chunks with embeddings using raw SQL (Prisma doesn't support Unsupported types directly)
        for (let j = 0; j < batch.length; j++) {
          const chunk = batch[j]
          const embedding = embeddings[j]
          const vectorString = `[${embedding.join(',')}]`

          await this.prisma.$executeRaw`
            UPDATE "CvChunk"
            SET embedding = ${vectorString}::vector
            WHERE id = ${chunk.id}
          `
          embedded++
        }
      } catch (error) {
        console.error('Error embedding CV chunks:', error)
        // Continue with remaining batches on error
      }
    }

    return { embedded, skipped: chunks.length - embedded }
  }

  /**
   * Embed all JDRuleChunks for a JD that don't have embeddings yet
   * Idempotent: only embeds chunks where embedding IS NULL
   */
  async embedJdRuleChunks(jdId: string): Promise<{ embedded: number; skipped: number }> {
    if (!this.genAI) {
      // No API key - skip embedding silently
      return { embedded: 0, skipped: 0 }
    }

    // Find chunks without embeddings.
    // Note: `embedding` is an Unsupported pgvector field, so Prisma can't filter on it.
    const chunks = await this.prisma.$queryRaw<Array<{ id: string; content: string }>>`
      SELECT c.id, c.content
      FROM "JDRuleChunk" c
      JOIN "JDRule" r ON r.id = c."ruleId"
      WHERE r."jdId" = ${jdId}
        AND c.embedding IS NULL
      ORDER BY r.id ASC, c.id ASC
    `

    if (chunks.length === 0) {
      return { embedded: 0, skipped: 0 }
    }

    // Process in batches
    let embedded = 0
    for (let i = 0; i < chunks.length; i += this.batchSize) {
      const batch = chunks.slice(i, i + this.batchSize)
      const contents = batch.map((c) => c.content)

      try {
        const embeddings = await this.generateEmbeddings(contents)

        // Validate dimension
        for (const embedding of embeddings) {
          if (embedding.length !== envConfig.EMBEDDING_DIM) {
            throw new Error(
              `Embedding dimension mismatch: expected ${envConfig.EMBEDDING_DIM}, got ${embedding.length}`,
            )
          }
        }

        // Update chunks with embeddings using raw SQL
        for (let j = 0; j < batch.length; j++) {
          const chunk = batch[j]
          const embedding = embeddings[j]
          const vectorString = `[${embedding.join(',')}]`

          await this.prisma.$executeRaw`
            UPDATE "JDRuleChunk"
            SET embedding = ${vectorString}::vector
            WHERE id = ${chunk.id}
          `
          embedded++
        }
      } catch (error) {
        console.error('Error embedding JD rule chunks:', error)
        // Continue with remaining batches on error
      }
    }

    return { embedded, skipped: chunks.length - embedded }
  }

  /**
   * Generate embeddings for multiple texts using Gemini
   */
  private async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!this.genAI) {
      throw new Error('Gemini API key not configured')
    }

    const model = this.genAI.getGenerativeModel({ model: envConfig.EMBEDDING_MODEL })

    const embeddings: number[][] = []

    // Gemini embedding API processes one at a time for text-embedding-005
    for (const text of texts) {
      const result = await model.embedContent(text)
      embeddings.push(result.embedding.values)
    }

    return embeddings
  }

  /**
   * Check if embeddings are enabled (API key configured)
   */
  isEnabled(): boolean {
    return this.genAI !== null
  }
}
