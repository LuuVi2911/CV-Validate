import { Injectable } from '@nestjs/common'
import { JdRepo } from './jd.repo'
import { JdRuleExtractionService } from 'src/shared/services/jd-rule-extraction.service'
import { JdRuleChunkingService } from 'src/shared/services/jd-rule-chunking.service'
import { JdNotFoundException, JdNotOwnedException, JdNoRulesException } from './jd.error'
import { JdRuleIntentClassifier } from 'src/shared/services/jd-rule-intent-classifier.service'
import { LoggerService } from 'src/shared/services/logger.service'

@Injectable()
export class JdService {
  constructor(
    private readonly jdRepo: JdRepo,
    private readonly jdRuleExtractionService: JdRuleExtractionService,
    private readonly jdRuleChunkingService: JdRuleChunkingService,
    private readonly intentClassifier: JdRuleIntentClassifier,
    private readonly logger: LoggerService,
  ) { }

  async createJd(userId: string, title: string | undefined, text: string) {
    // Stage 8: Create JD record
    const jd = await this.jdRepo.createJd(userId, title)

    try {
      // Stage 9: Extract rules from JD text (Smart LLM parsing with fallback)
      const extractedRules = await this.jdRuleExtractionService.extractRulesSemantically(text)

      if (extractedRules.length === 0) {
        throw JdNoRulesException
      }

      // Stage 10: Chunk rules into smaller matchable units
      // If smart parser provided chunks, use them directly; otherwise use chunking service
      const chunksMap = new Map<number, Array<{ content: string }>>()
      for (let i = 0; i < extractedRules.length; i++) {
        const rule = extractedRules[i]
        if (rule.chunks && rule.chunks.length > 0) {
          // Use smart parser chunks
          chunksMap.set(
            i,
            rule.chunks.map((chunk) => ({ content: chunk })),
          )
        } else {
          // Fallback to chunking service for regex-based rules
          const fallbackChunks = this.jdRuleChunkingService.createChunks([rule])
          chunksMap.set(i, fallbackChunks.get(0) || [])
        }
      }

      // Persist rules and chunks
      const createdRules: Array<{ id: string; content: string }> = []
      for (let i = 0; i < extractedRules.length; i++) {
        const extractedRule = extractedRules[i]
        const rule = await this.jdRepo.createJdRule(jd.id, extractedRule.ruleType, extractedRule.content)
        createdRules.push({ id: rule.id, content: rule.content })

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

      // Stage 10.5: Classify rule intents (async, non-blocking)
      // This runs in background to avoid blocking JD upload
      this.classifyRuleIntents(createdRules).catch((error) => {
        this.logger.logError(error as Error, {
          service: 'JdService',
          operation: 'classifyRuleIntents',
          jdId: jd.id,
        })
      })

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
    await this.ensureJdExists(userId, jdId)
    await this.jdRepo.deleteJd(jdId)
    return { message: 'JD deleted successfully' }
  }

  /**
   * Classify rule intents in background (non-blocking)
   */
  private async classifyRuleIntents(rules: Array<{ id: string; content: string }>) {
    if (rules.length === 0) return

    this.logger.logInfo('Classifying rule intents', {
      service: 'JdService',
      ruleCount: rules.length,
    })

    try {
      // Batch classify all rules
      const intents = await this.intentClassifier.classifyBatch(rules)

      // Update database with classifications
      const updates: Array<Promise<any>> = []
      intents.forEach((intent, ruleId) => {
        updates.push(this.jdRepo.updateRuleIntent(ruleId, intent))
      })

      await Promise.all(updates)

      this.logger.logInfo('Rule intents classified successfully', {
        service: 'JdService',
        ruleCount: rules.length,
      })
    } catch (error) {
      this.logger.logError(error as Error, {
        service: 'JdService',
        operation: 'classifyRuleIntents',
      })
      throw error
    }
  }
}
