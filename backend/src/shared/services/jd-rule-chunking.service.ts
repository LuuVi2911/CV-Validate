import { Injectable } from '@nestjs/common'
import type { ExtractedRule } from './jd-rule-extraction.service'

export interface RuleChunkData {
  ruleIndex: number
  content: string
}

/**
 * JdRuleChunkingService - Stage 10
 *
 * Purpose: Split each JDRule into smaller JDRuleChunk units that are
 * matchable to CV bullets.
 *
 * Allowed logic:
 * - Deterministic splitting (comma/semicolon/"and"/list heuristics)
 *   to create atomic requirements
 *
 * Forbidden logic:
 * - Any embeddings/matching
 * - Any LLM usage
 */
@Injectable()
export class JdRuleChunkingService {
  private readonly MAX_CHUNK_LENGTH = 300
  private readonly MIN_CHUNK_LENGTH = 15
  /**
   * Create chunks from extracted rules
   * Each rule may produce multiple chunks if it contains multiple atomic requirements
   */
  createChunks(rules: ExtractedRule[]): Map<number, RuleChunkData[]> {
    const chunksMap = new Map<number, RuleChunkData[]>()

    rules.forEach((rule, ruleIndex) => {
      const chunks = this.chunkRule(rule.content, ruleIndex)
      chunksMap.set(ruleIndex, chunks)
    })

    return chunksMap
  }

  /**
   * Chunk a single rule into atomic requirement units
   */
  private chunkRule(content: string, ruleIndex: number): RuleChunkData[] {
    const normalized = content.replace(/\s+/g, ' ').trim()
    if (!normalized) return []

    // Split by bullet markers, numbered lists, semicolons
    const initialChunks = this.splitByPunctuation(normalized)
    const atomicChunks: RuleChunkData[] = []

    for (const chunk of initialChunks) {
      if (chunk.length <= this.MAX_CHUNK_LENGTH) {
        if (chunk.length >= this.MIN_CHUNK_LENGTH) {
          atomicChunks.push({ ruleIndex, content: this.normalizeChunkContent(chunk) })
        }
      } else {
        // Further split long chunks by commas + tech stack detection
        const subChunks = this.splitByCommasAndTech(chunk)
        for (const sub of subChunks) {
          if (sub.length >= this.MIN_CHUNK_LENGTH) {
            atomicChunks.push({
              ruleIndex,
              content: this.normalizeChunkContent(sub.slice(0, this.MAX_CHUNK_LENGTH)),
            })
          }
        }
      }
    }

    return atomicChunks
  }

  private splitByPunctuation(text: string): string[] {
    return text
      .split(/(?:[-*•●]|^\d{1,3}[.)])|;/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }

  private splitByCommasAndTech(text: string): string[] {
    const commaCount = (text.match(/,/g) || []).length
    if (commaCount >= 2 || text.length > this.MAX_CHUNK_LENGTH) {
      return text.split(/,\s+/).map((s) => s.trim())
    }
    return [text]
  }

  /**
   * Normalize chunk content
   * - Collapse whitespace
   * - Trim
   * - Remove trailing punctuation that's not meaningful
   */
  private normalizeChunkContent(content: string): string {
    return content
      .replace(/\s+/g, ' ')
      .replace(/[,;:]+$/, '') // Remove trailing punctuation
      .trim()
  }
}

