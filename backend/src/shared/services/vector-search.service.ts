import { Injectable } from '@nestjs/common'
import { PrismaService } from './prisma.service'

export interface VectorMatchCandidate {
  cvChunkId: string
  sectionId: string
  sectionType: string
  content: string
  score: number
}

/**
 * VectorSearchService - Stage 12
 *
 * Purpose: Retrieve top-K candidate CvChunk matches for each JDRuleChunk
 * using pgvector cosine similarity.
 *
 * Allowed logic:
 * - Pure similarity retrieval via pgvector
 * - Deterministic sorting with stable tie-break
 *
 * Forbidden logic:
 * - Any CV readiness logic
 * - Any rule scoring beyond constructing trace
 */
@Injectable()
export class VectorSearchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find top-K matching CV chunks for a JD rule chunk using cosine similarity
   *
   * Stable tie-break order:
   * 1. similarity desc
   * 2. CvChunk.sectionId asc
   * 3. CvChunk.order asc
   * 4. CvChunk.id asc
   *
   * @param ruleChunkId JD rule chunk ID to match against
   * @param cvId CV ID to search within
   * @param topK Number of top matches to return
   * @returns Array of matching candidates with similarity scores
   */
  async findTopKMatches(ruleChunkId: string, cvId: string, topK: number): Promise<VectorMatchCandidate[]> {
    // Use raw SQL with pgvector cosine similarity operator
    // The <=> operator computes cosine distance (1 - cosine_similarity)
    // So we need to convert: similarity = 1 - distance
    const results = await this.prisma.$queryRaw<
      Array<{
        cv_chunk_id: string
        section_id: string
        section_type: string
        content: string
        similarity: number
      }>
    >`
      SELECT
        cc.id as cv_chunk_id,
        cc."sectionId" as section_id,
        cs.type as section_type,
        cc.content,
        1 - (cc.embedding <=> jrc.embedding) as similarity
      FROM "CvChunk" cc
      JOIN "CvSection" cs ON cc."sectionId" = cs.id
      JOIN "JDRuleChunk" jrc ON jrc.id = ${ruleChunkId}
      WHERE cs."cvId" = ${cvId}
        AND cc.embedding IS NOT NULL
        AND jrc.embedding IS NOT NULL
      ORDER BY
        cc.embedding <=> jrc.embedding ASC,  -- similarity desc (distance asc)
        cc."sectionId" ASC,
        cc."order" ASC,
        cc.id ASC
      LIMIT ${topK}
    `

    return results.map((row) => ({
      cvChunkId: row.cv_chunk_id,
      sectionId: row.section_id,
      sectionType: row.section_type,
      content: row.content,
      score: Number(row.similarity),
    }))
  }

  /**
   * Find all matches for multiple rule chunks in a single batch operation
   * More efficient than calling findTopKMatches repeatedly
   */
  async findTopKMatchesBatch(
    ruleChunkIds: string[],
    cvId: string,
    topK: number,
  ): Promise<Map<string, VectorMatchCandidate[]>> {
    const resultMap = new Map<string, VectorMatchCandidate[]>()

    // Initialize empty arrays for each rule chunk
    for (const ruleChunkId of ruleChunkIds) {
      resultMap.set(ruleChunkId, [])
    }

    if (ruleChunkIds.length === 0) {
      return resultMap
    }

    // Use a lateral join to get top-K for each rule chunk efficiently
    // This is more efficient than N separate queries
    const results = await this.prisma.$queryRaw<
      Array<{
        rule_chunk_id: string
        cv_chunk_id: string
        section_id: string
        section_type: string
        content: string
        similarity: number
        rank: number
      }>
    >`
      WITH RuleChunkEmbeddings AS (
        SELECT id, embedding
        FROM "JDRuleChunk"
        WHERE id = ANY(${ruleChunkIds})
          AND embedding IS NOT NULL
      ),
      CvChunksWithEmbeddings AS (
        SELECT
          cc.id,
          cc."sectionId",
          cs.type as section_type,
          cc.content,
          cc."order",
          cc.embedding
        FROM "CvChunk" cc
        JOIN "CvSection" cs ON cc."sectionId" = cs.id
        WHERE cs."cvId" = ${cvId}
          AND cc.embedding IS NOT NULL
      ),
      RankedMatches AS (
        SELECT
          rce.id as rule_chunk_id,
          cce.id as cv_chunk_id,
          cce."sectionId" as section_id,
          cce.section_type,
          cce.content,
          1 - (cce.embedding <=> rce.embedding) as similarity,
          ROW_NUMBER() OVER (
            PARTITION BY rce.id
            ORDER BY
              cce.embedding <=> rce.embedding ASC,
              cce."sectionId" ASC,
              cce."order" ASC,
              cce.id ASC
          ) as rank
        FROM RuleChunkEmbeddings rce
        CROSS JOIN CvChunksWithEmbeddings cce
      )
      SELECT
        rule_chunk_id,
        cv_chunk_id,
        section_id,
        section_type,
        content,
        similarity,
        rank
      FROM RankedMatches
      WHERE rank <= ${topK}
      ORDER BY rule_chunk_id, rank
    `

    // Group results by rule chunk ID
    for (const row of results) {
      const candidates = resultMap.get(row.rule_chunk_id) || []
      candidates.push({
        cvChunkId: row.cv_chunk_id,
        sectionId: row.section_id,
        sectionType: row.section_type,
        content: row.content,
        score: Number(row.similarity),
      })
      resultMap.set(row.rule_chunk_id, candidates)
    }

    return resultMap
  }
}
