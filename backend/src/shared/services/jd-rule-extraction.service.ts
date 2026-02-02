import { Injectable } from '@nestjs/common'
import { RuleType } from 'src/generated/prisma/enums'
import { RULE_TYPE_CUE_PHRASES } from 'src/rules/student-fresher/jd-matching.rules'

export interface ExtractedRule {
  content: string
  ruleType: RuleType
  originalText: string
}

/**
 * JdRuleExtractionService - Stage 9
 *
 * Purpose: Normalize JD text into deterministic JDRule rows with RuleType.
 *
 * Allowed logic:
 * - Heuristic splitting into statements/bullets
 * - Deterministic ruleType classification (cue phrases)
 * - Default fallback bucket: BEST_PRACTICE
 *
 * Forbidden logic:
 * - Any LLM usage
 * - Any inference of seniority/role level beyond literal text normalization
 * - Any scoring or matching
 */
@Injectable()
export class JdRuleExtractionService {
  /**
   * Extract rules from JD text deterministically
   * @param text Raw JD text
   * @returns Array of extracted rules with their types
   */
  extractRules(text: string): ExtractedRule[] {
    // Normalize and split into statements
    const statements = this.splitIntoStatements(text)

    // Classify each statement into a rule type
    return statements.map((statement) => ({
      content: this.normalizeContent(statement),
      ruleType: this.classifyRuleType(statement),
      originalText: statement,
    }))
  }

  /**
   * Split JD text into individual statement units
   * Uses multiple heuristics: bullets, numbered lists, sentences
   */
  private splitIntoStatements(text: string): string[] {
    const statements: string[] = []
    const lines = text.split('\n')

    let currentBlock: string[] = []

    for (const line of lines) {
      const trimmedLine = line.trim()

      if (!trimmedLine) {
        // Empty line - flush current block
        if (currentBlock.length > 0) {
          const block = currentBlock.join(' ')
          statements.push(...this.splitBlockIntoStatements(block))
          currentBlock = []
        }
        continue
      }

      // Check if this is a new bullet/numbered item
      if (this.isBulletOrNumberedLine(trimmedLine)) {
        // Flush previous block
        if (currentBlock.length > 0) {
          const block = currentBlock.join(' ')
          statements.push(...this.splitBlockIntoStatements(block))
          currentBlock = []
        }
        // Start new block with bullet content (remove bullet marker)
        currentBlock.push(this.removeBulletMarker(trimmedLine))
      } else {
        // Continuation of current block
        currentBlock.push(trimmedLine)
      }
    }

    // Don't forget the last block
    if (currentBlock.length > 0) {
      const block = currentBlock.join(' ')
      statements.push(...this.splitBlockIntoStatements(block))
    }

    // Filter out very short statements and deduplicate
    return this.deduplicateStatements(statements.map((s) => s.trim()).filter((s) => s.length >= 10))
  }

  /**
   * Split a text block into individual statements
   * If the block contains multiple requirements separated by conjunctions, split them
   */
  private splitBlockIntoStatements(block: string): string[] {
    // Check for common separators that indicate multiple requirements
    const separatorPatterns = [
      /\s*;\s*/, // Semicolon
      /\s*,\s*and\s+/i, // ", and"
      /\s+and\s+(?=\w+(?:ing|ed|tion|ment))/i, // "and" before action words
    ]

    // Don't split short blocks
    if (block.length < 100) {
      return [block]
    }

    // Try splitting by separators
    for (const pattern of separatorPatterns) {
      if (pattern.test(block)) {
        const parts = block.split(pattern).filter((p) => p.trim().length >= 10)
        if (parts.length > 1 && parts.every((p) => p.length >= 10)) {
          return parts
        }
      }
    }

    return [block]
  }

  /**
   * Check if a line starts with a bullet or number marker
   */
  private isBulletOrNumberedLine(line: string): boolean {
    const patterns = [
      /^[-•●○◦▪▸►]\s+/, // Common bullet characters
      /^\*\s+/, // Asterisk bullet
      /^\d+\.\s+/, // Numbered list (1. 2. 3.)
      /^\([a-z]\)\s+/i, // Lettered list (a) (b) (c)
      /^[a-z]\)\s+/i, // Lettered list a) b) c)
      /^➢\s*/, // Arrow bullet
      /^✓\s*/, // Checkmark
    ]
    return patterns.some((p) => p.test(line))
  }

  /**
   * Remove bullet marker from the beginning of a line
   */
  private removeBulletMarker(line: string): string {
    const patterns = [/^[-•●○◦▪▸►]\s+/, /^\*\s+/, /^\d+\.\s+/, /^\([a-z]\)\s+/i, /^[a-z]\)\s+/i, /^➢\s*/, /^✓\s*/]
    for (const pattern of patterns) {
      if (pattern.test(line)) {
        return line.replace(pattern, '')
      }
    }
    return line
  }

  /**
   * Classify statement into rule type using cue phrases
   * Default: BEST_PRACTICE (as specified in the plan)
   */
  private classifyRuleType(statement: string): RuleType {
    const lowerStatement = statement.toLowerCase()

    // Check for MUST_HAVE cue phrases
    for (const phrase of RULE_TYPE_CUE_PHRASES.MUST_HAVE) {
      if (lowerStatement.includes(phrase.toLowerCase())) {
        return RuleType.MUST_HAVE
      }
    }

    // Check for NICE_TO_HAVE cue phrases
    for (const phrase of RULE_TYPE_CUE_PHRASES.NICE_TO_HAVE) {
      if (lowerStatement.includes(phrase.toLowerCase())) {
        return RuleType.NICE_TO_HAVE
      }
    }

    // Default to BEST_PRACTICE
    return RuleType.BEST_PRACTICE
  }

  /**
   * Normalize content for storage
   * - Collapse whitespace
   * - Trim
   */
  private normalizeContent(text: string): string {
    return text.replace(/\s+/g, ' ').trim()
  }

  /**
   * Remove duplicate or near-duplicate statements
   */
  private deduplicateStatements(statements: string[]): string[] {
    const seen = new Set<string>()
    const result: string[] = []

    for (const statement of statements) {
      // Create a simplified version for comparison
      const simplified = statement.toLowerCase().replace(/\s+/g, ' ').trim()

      if (!seen.has(simplified)) {
        seen.add(simplified)
        result.push(statement)
      }
    }

    return result
  }
}
