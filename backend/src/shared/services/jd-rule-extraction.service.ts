import { Injectable } from '@nestjs/common'
import { RuleType, JDParagraphType } from 'src/generated/prisma/enums'
import { RULE_TYPE_CUE_PHRASES } from 'src/rules/student-fresher/jd-matching.rules'

export interface ExtractedRule {
  content: string
  ruleType: RuleType
  paragraphType: JDParagraphType
  ignored: boolean
  originalText: string
  sourceParagraphType: JDParagraphType
  sourceParagraphIndex: number
  ignoredReason?: string
}

/**
 * JD Paragraph Classification Cues
 * Used for noise filtering - to ignore BENEFITS/COMPANY/PROCESS paragraphs
 */
const PARAGRAPH_CLASSIFICATION_CUES = {
  REQUIREMENTS: ['must', 'required', 'minimum', 'you have', 'qualifications', 'requirements'],
  NICE_TO_HAVE: ['preferred', 'bonus', 'plus', 'nice to have', 'would be great'],
  RESPONSIBILITIES: ['you will', 'responsibilities', 'role includes', 'in this role', 'you\'ll'],
  BENEFITS: ['salary', 'benefits', 'wellness', 'lunch', 'healthcare', 'work-life'],
  PROCESS: ['recruitment process', 'interview', 'apply', 'deadline', 'rolling basis'],
  COMPANY: ['we are', 'about us', 'our culture', 'values', 'diversity', 'inclusion'],
} as const

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
   * With noise filtering: BENEFITS/COMPANY/PROCESS paragraphs are marked as ignored
   * @param text Raw JD text
   * @returns Array of extracted rules with their types and paragraph classification
   */
  extractRules(text: string): ExtractedRule[] {
    // Normalize and split into statements
    const statements = this.splitIntoStatements(text)

    // Classify each statement into a rule type and paragraph type
    return statements.map((statement, index) => {
      const { type, ignored, reason } = this.classifyParagraph(statement)

      return {
        content: this.normalizeContent(statement),
        ruleType: this.mapParagraphToRuleType(type, statement),
        paragraphType: type,
        ignored,
        originalText: statement,
        sourceParagraphType: type,
        sourceParagraphIndex: index,
        ignoredReason: reason,
      }
    })
  }

  /**
   * Extract only non-ignored rules (for JD matching)
   */
  extractValidRules(text: string): ExtractedRule[] {
    return this.extractRules(text).filter((rule) => !rule.ignored)
  }

  /**
   * Classify paragraph with deterministic cues
   * Returns { type, ignored, reason }
   */
  classifyParagraph(text: string): { type: JDParagraphType; ignored: boolean; reason?: string } {
    const lower = text.toLowerCase()

    // Deterministic cues (classification-only)
    if (this.hasCue(lower, PARAGRAPH_CLASSIFICATION_CUES.REQUIREMENTS)) {
      return { type: JDParagraphType.REQUIREMENTS, ignored: false }
    }
    if (this.hasCue(lower, PARAGRAPH_CLASSIFICATION_CUES.NICE_TO_HAVE)) {
      return { type: JDParagraphType.NICE_TO_HAVE, ignored: false }
    }
    if (this.hasCue(lower, PARAGRAPH_CLASSIFICATION_CUES.RESPONSIBILITIES)) {
      return { type: JDParagraphType.RESPONSIBILITIES, ignored: false }
    }
    if (this.hasCue(lower, PARAGRAPH_CLASSIFICATION_CUES.BENEFITS)) {
      return { type: JDParagraphType.BENEFITS, ignored: true, reason: 'BENEFITS paragraph ignored' }
    }
    if (this.hasCue(lower, PARAGRAPH_CLASSIFICATION_CUES.PROCESS)) {
      return { type: JDParagraphType.PROCESS, ignored: true, reason: 'PROCESS paragraph ignored' }
    }
    if (this.hasCue(lower, PARAGRAPH_CLASSIFICATION_CUES.COMPANY)) {
      return { type: JDParagraphType.COMPANY, ignored: true, reason: 'COMPANY paragraph ignored' }
    }

    // Default: OTHER (modeled as UNKNOWN)
    return { type: JDParagraphType.UNKNOWN, ignored: true, reason: 'OTHER paragraph ignored by default' }
  }

  private hasCue(text: string, cues: readonly string[]): boolean {
    return cues.some((cue) => text.includes(cue))
  }

  /**
   * Map paragraph type to JDRule.ruleType
   */
  private mapParagraphToRuleType(paragraphType: JDParagraphType, statement: string): RuleType {
    switch (paragraphType) {
      case JDParagraphType.REQUIREMENTS:
        return RuleType.MUST_HAVE
      case JDParagraphType.NICE_TO_HAVE:
        return RuleType.NICE_TO_HAVE
      case JDParagraphType.RESPONSIBILITIES:
        return RuleType.BEST_PRACTICE
      default:
        return RuleType.BEST_PRACTICE
    }
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
