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
    // Try to split into atomic requirements
    const atomicRequirements = this.splitIntoAtomicRequirements(content)

    // If we couldn't split, use the whole content as one chunk
    if (atomicRequirements.length === 0) {
      return [{ ruleIndex, content: this.normalizeChunkContent(content) }]
    }

    return atomicRequirements.map((requirement) => ({
      ruleIndex,
      content: this.normalizeChunkContent(requirement),
    }))
  }

  /**
   * Split rule content into atomic requirements
   * Uses multiple heuristics to identify separate requirements within a single rule
   */
  private splitIntoAtomicRequirements(content: string): string[] {
    // If content is short enough, don't split
    if (content.length < 80) {
      return [content]
    }

    // Try different splitting strategies
    const results: string[] = []

    // Strategy 1: Split by comma followed by skill/technology patterns
    const commaSplitPattern = /,\s*(?=\w+(?:\s+\w+)?(?:\s*\([^)]+\))?$)/
    if (commaSplitPattern.test(content)) {
      const parts = content.split(/,\s*/)
      if (parts.length > 1 && parts.every((p) => p.trim().length >= 3)) {
        results.push(...parts.map((p) => p.trim()))
        return results.filter((r) => r.length >= 10)
      }
    }

    // Strategy 2: Split by "and/or" when listing requirements
    const andOrPattern = /\s+(?:and|or)\s+(?=[A-Z]|\w+(?:ing|tion|ment|able))/
    if (andOrPattern.test(content)) {
      const parts = content.split(andOrPattern)
      if (parts.length > 1 && parts.every((p) => p.trim().length >= 10)) {
        results.push(...parts.map((p) => p.trim()))
        return results.filter((r) => r.length >= 10)
      }
    }

    // Strategy 3: Split by semicolon
    if (content.includes(';')) {
      const parts = content.split(/;\s*/)
      if (parts.length > 1 && parts.every((p) => p.trim().length >= 10)) {
        results.push(...parts.map((p) => p.trim()))
        return results.filter((r) => r.length >= 10)
      }
    }

    // Strategy 4: Split by slash when listing alternatives
    if (content.includes('/') && content.split('/').length <= 4) {
      const parts = content.split(/\s*\/\s*/)
      if (parts.length > 1 && parts.every((p) => p.trim().length >= 3)) {
        // Create a chunk for each alternative
        results.push(...parts.map((p) => p.trim()))
        return results.filter((r) => r.length >= 3)
      }
    }

    // No splitting applied - return original
    return [content]
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
