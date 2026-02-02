import { Injectable } from '@nestjs/common'
import { JdRepo } from './jd.repo'
import { JdRuleExtractionService } from 'src/shared/services/jd-rule-extraction.service'
import { JdRuleChunkingService } from 'src/shared/services/jd-rule-chunking.service'
import { JdNotFoundException, JdNotOwnedException, JdNoRulesException } from './jd.error'

@Injectable()
export class JdService {
  constructor(
    private readonly jdRepo: JdRepo,
    private readonly jdRuleExtractionService: JdRuleExtractionService,
    private readonly jdRuleChunkingService: JdRuleChunkingService,
  ) {}

  async createJd(userId: string, title: string | undefined, text: string) {
    // Stage 8: Create JD record
    const jd = await this.jdRepo.createJd(userId, title)

    try {
      // Stage 9: Extract rules from JD text (deterministic, no LLM)
      const extractedRules = this.jdRuleExtractionService.extractRules(text)

      if (extractedRules.length === 0) {
        throw JdNoRulesException
      }

      // Stage 10: Chunk rules into smaller matchable units
      const chunksMap = this.jdRuleChunkingService.createChunks(extractedRules)

      // Persist rules and chunks
      for (let i = 0; i < extractedRules.length; i++) {
        const extractedRule = extractedRules[i]
        const rule = await this.jdRepo.createJdRule(jd.id, extractedRule.ruleType, extractedRule.content)

        // Get chunks for this rule
        const ruleChunks = chunksMap.get(i) || []

        // Create chunks for this rule
        if (ruleChunks.length > 0) {
          const chunksToCreate = ruleChunks.map((chunk) => ({
            ruleId: rule.id,
            content: chunk.content,
          }))
          await this.jdRepo.createJdRuleChunks(chunksToCreate)
        }
      }

      return {
        jdId: jd.id,
      }
    } catch (error) {
      // Clean up on failure
      await this.jdRepo.deleteJd(jd.id)
      throw error
    }
  }

  async getJdById(userId: string, jdId: string) {
    const jd = await this.jdRepo.findJdByIdWithRulesAndChunks(jdId)

    if (!jd) {
      throw JdNotFoundException
    }

    if (jd.userId !== userId) {
      throw JdNotOwnedException
    }

    return {
      id: jd.id,
      userId: jd.userId,
      title: jd.title,
      createdAt: jd.createdAt,
      rules: jd.rules.map((rule) => ({
        id: rule.id,
        jdId: rule.jdId,
        ruleType: rule.ruleType,
        content: rule.content,
        chunks: rule.chunks.map((chunk) => ({
          id: chunk.id,
          ruleId: chunk.ruleId,
          content: chunk.content,
        })),
      })),
    }
  }

  async listJds(userId: string) {
    const jds = await this.jdRepo.findJdsByUserId(userId)

    return {
      jds: jds.map((jd) => ({
        id: jd.id,
        title: jd.title,
        createdAt: jd.createdAt,
        ruleCount: jd.rules.length,
        chunkCount: jd.rules.reduce((acc, rule) => acc + rule._count.chunks, 0),
      })),
    }
  }

  async ensureJdExists(userId: string, jdId: string) {
    const jd = await this.jdRepo.findJdById(jdId)

    if (!jd) {
      throw JdNotFoundException
    }

    if (jd.userId !== userId) {
      throw JdNotOwnedException
    }

    return jd
  }

  async deleteJd(userId: string, jdId: string) {
    const jd = await this.jdRepo.findJdById(jdId)

    if (!jd) {
      throw JdNotFoundException
    }

    if (jd.userId !== userId) {
      throw JdNotOwnedException
    }

    await this.jdRepo.deleteJd(jdId)

    return { message: 'JD deleted successfully' }
  }
}
