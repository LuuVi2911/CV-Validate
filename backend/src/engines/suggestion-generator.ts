import { Injectable } from '@nestjs/common'
import type { CvSectionType } from 'src/generated/prisma/enums'
import type { Gap, GapSeverity } from './gap-detector'
import type { RuleEvaluationResult } from './semantic/semantic-evaluator'

/**
 * SUGGESTION GENERATOR
 *
 * Generates deterministic, actionable suggestions based on gaps and partial matches.
 *
 * Rules:
 * - Suggestions are generated ONLY from gaps and PARTIALs
 * - NO LLM usage
 * - Uses short "concept labels" extracted from rule chunks
 * - Never pastes raw JD text
 */

// =============================================================================
// TYPES
// =============================================================================

export type SuggestionActionType = 'ADD_BULLET' | 'EXPAND_BULLET' | 'ADD_METRIC' | 'ADD_LINK'

export interface Suggestion {
  suggestionId: string
  ruleId: string
  ruleKey: string
  ruleChunkId: string
  severity: GapSeverity
  type: 'MISSING' | 'PARTIAL'
  message: string
  targetCvChunkId: string | null
  sectionType: CvSectionType | null
  evidenceSnippet: string | null
  suggestedActionType: SuggestionActionType
  conceptLabel: string // short keyword extraction from rule chunk
}

export interface SuggestionResult {
  suggestions: Suggestion[]
  summary: {
    total: number
    addBullet: number
    expandBullet: number
    addMetric: number
    addLink: number
  }
}

// =============================================================================
// TEMPLATES
// =============================================================================

const MISSING_TEMPLATES = [
  'Add a bullet showing hands-on experience with {label}.',
  'If you have done {label}, include one concrete example and the outcome.',
  'Consider adding a project or experience demonstrating {label}.',
]

const PARTIAL_TEMPLATES = [
  'Expand this bullet to clarify how you used {label} and the impact.',
  'Add a measurable result related to {label} (speed, users, cost, reliability).',
  'Strengthen your evidence for {label} with specific examples or metrics.',
]

const METRIC_TEMPLATES = [
  'Add quantifiable results (numbers, percentages, or timeframes) for {label}.',
  'Include specific metrics showing your impact with {label}.',
]

// =============================================================================
// STOPWORDS
// =============================================================================

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'ought',
  'of', 'in', 'to', 'for', 'with', 'on', 'at', 'by', 'from', 'as',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'and', 'or', 'but', 'if', 'then', 'else', 'when', 'where', 'why',
  'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'some',
  'any', 'no', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'just', 'also', 'now', 'about', 'this', 'that', 'these', 'those',
  'such', 'what', 'which', 'who', 'whom', 'your', 'their', 'its',
  'cv', 'resume', 'candidate', 'applicant', 'demonstrate', 'show',
  'include', 'using', 'use', 'work', 'working', 'experience', 'skill',
])

// =============================================================================
// SERVICE
// =============================================================================

@Injectable()
export class SuggestionGenerator {
  /**
   * Generate suggestions from gaps.
   */
  generateFromGaps(gaps: Gap[]): SuggestionResult {
    const suggestions: Suggestion[] = []
    let counter = 0

    for (const gap of gaps) {
      // Skip NO_GAP
      if (gap.severity === 'NO_GAP') continue

      counter++
      const suggestion = this.createSuggestionFromGap(gap, counter)
      suggestions.push(suggestion)
    }

    return this.buildSummary(suggestions)
  }

  /**
   * Generate suggestions from evaluation results (for partial matches).
   */
  generateFromEvaluationResults(results: RuleEvaluationResult[]): SuggestionResult {
    const suggestions: Suggestion[] = []
    let counter = 0

    for (const result of results) {
      // Only generate suggestions for PARTIAL results
      if (result.result !== 'PARTIAL') continue

      for (const chunkEvidence of result.chunkEvidence) {
        // Only for AMBIGUOUS chunks
        if (chunkEvidence.bestBand !== 'AMBIGUOUS') continue

        counter++
        const suggestion = this.createSuggestionForPartial(
          result.ruleId,
          result.ruleKey,
          chunkEvidence.ruleChunkId,
          chunkEvidence.ruleChunkContent,
          chunkEvidence.bestCandidate?.cvChunkId ?? null,
          chunkEvidence.bestCandidate?.sectionType ?? null,
          chunkEvidence.bestCandidate?.snippet ?? null,
          counter,
        )
        suggestions.push(suggestion)
      }
    }

    return this.buildSummary(suggestions)
  }

  /**
   * Merge gap-based and evaluation-based suggestions.
   */
  mergeSuggestions(
    gapSuggestions: SuggestionResult,
    evalSuggestions: SuggestionResult,
  ): SuggestionResult {
    // Deduplicate by ruleChunkId
    const seen = new Set<string>()
    const merged: Suggestion[] = []

    for (const s of gapSuggestions.suggestions) {
      if (!seen.has(s.ruleChunkId)) {
        seen.add(s.ruleChunkId)
        merged.push(s)
      }
    }

    for (const s of evalSuggestions.suggestions) {
      if (!seen.has(s.ruleChunkId)) {
        seen.add(s.ruleChunkId)
        merged.push(s)
      }
    }

    return this.buildSummary(merged)
  }

  /**
   * Create suggestion from a gap.
   */
  private createSuggestionFromGap(gap: Gap, counter: number): Suggestion {
    const conceptLabel = this.extractConceptLabel(gap.ruleChunkContent)
    const isMissing = gap.band === 'NO_EVIDENCE' || gap.band === 'LOW'
    const type: 'MISSING' | 'PARTIAL' = isMissing ? 'MISSING' : 'PARTIAL'
    const actionType = this.determineActionType(gap, isMissing)
    const message = this.generateMessage(type, conceptLabel, actionType)

    return {
      suggestionId: `SUG-${counter.toString().padStart(4, '0')}`,
      ruleId: gap.ruleId,
      ruleKey: gap.ruleKey,
      ruleChunkId: gap.ruleChunkId,
      severity: gap.severity,
      type,
      message,
      targetCvChunkId: gap.bestCvChunkId,
      sectionType: (gap.sectionType as CvSectionType) ?? null,
      evidenceSnippet: gap.bestCvChunkSnippet,
      suggestedActionType: actionType,
      conceptLabel,
    }
  }

  /**
   * Create suggestion for a partial match.
   */
  private createSuggestionForPartial(
    ruleId: string,
    ruleKey: string,
    ruleChunkId: string,
    ruleChunkContent: string,
    targetCvChunkId: string | null,
    sectionType: CvSectionType | null,
    evidenceSnippet: string | null,
    counter: number,
  ): Suggestion {
    const conceptLabel = this.extractConceptLabel(ruleChunkContent)
    const actionType = targetCvChunkId ? 'EXPAND_BULLET' : 'ADD_BULLET'
    const message = this.generateMessage('PARTIAL', conceptLabel, actionType)

    return {
      suggestionId: `SUG-${counter.toString().padStart(4, '0')}`,
      ruleId,
      ruleKey,
      ruleChunkId,
      severity: 'IMPROVEMENT',
      type: 'PARTIAL',
      message,
      targetCvChunkId,
      sectionType,
      evidenceSnippet,
      suggestedActionType: actionType,
      conceptLabel,
    }
  }

  /**
   * Extract concept label from rule chunk content.
   * Uses deterministic keyword extraction.
   */
  private extractConceptLabel(content: string): string {
    // If content is short (likely a skill/tool phrase), use it directly
    if (content.length <= 50) {
      return content.trim()
    }

    // Tokenize and extract keywords
    const tokens = content
      .toLowerCase()
      .replace(/[^a-z0-9\s\-\/\.]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2)
      .filter((t) => !STOPWORDS.has(t))

    // Count frequency
    const frequency = new Map<string, number>()
    for (const token of tokens) {
      frequency.set(token, (frequency.get(token) || 0) + 1)
    }

    // Sort by frequency desc, then alphabetically
    const sorted = Array.from(frequency.entries())
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1]
        return a[0].localeCompare(b[0])
      })
      .slice(0, 5)
      .map(([word]) => word)

    if (sorted.length === 0) {
      return content.slice(0, 50).trim()
    }

    return sorted.join(', ')
  }

  /**
   * Determine action type based on gap and context.
   */
  private determineActionType(gap: Gap, isMissing: boolean): SuggestionActionType {
    // If no target chunk, suggest adding a bullet
    if (isMissing || !gap.bestCvChunkId) {
      // Check if this might be about metrics
      const content = gap.ruleChunkContent.toLowerCase()
      if (content.includes('metric') || content.includes('number') || content.includes('quantif')) {
        return 'ADD_METRIC'
      }
      if (content.includes('link') || content.includes('url') || content.includes('github') || content.includes('linkedin')) {
        return 'ADD_LINK'
      }
      return 'ADD_BULLET'
    }

    // Has target chunk, suggest expanding
    const content = gap.ruleChunkContent.toLowerCase()
    if (content.includes('metric') || content.includes('result') || content.includes('outcome')) {
      return 'ADD_METRIC'
    }

    return 'EXPAND_BULLET'
  }

  /**
   * Generate message using templates.
   */
  private generateMessage(
    type: 'MISSING' | 'PARTIAL',
    conceptLabel: string,
    actionType: SuggestionActionType,
  ): string {
    let templates: string[]

    if (actionType === 'ADD_METRIC') {
      templates = METRIC_TEMPLATES
    } else if (type === 'MISSING') {
      templates = MISSING_TEMPLATES
    } else {
      templates = PARTIAL_TEMPLATES
    }

    // Select template deterministically based on label hash
    const hash = this.simpleHash(conceptLabel)
    const template = templates[hash % templates.length]

    return template.replace('{label}', conceptLabel)
  }

  /**
   * Simple deterministic hash for template selection.
   */
  private simpleHash(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32bit integer
    }
    return Math.abs(hash)
  }

  /**
   * Build summary from suggestions.
   */
  private buildSummary(suggestions: Suggestion[]): SuggestionResult {
    const summary = {
      total: suggestions.length,
      addBullet: suggestions.filter((s) => s.suggestedActionType === 'ADD_BULLET').length,
      expandBullet: suggestions.filter((s) => s.suggestedActionType === 'EXPAND_BULLET').length,
      addMetric: suggestions.filter((s) => s.suggestedActionType === 'ADD_METRIC').length,
      addLink: suggestions.filter((s) => s.suggestedActionType === 'ADD_LINK').length,
    }

    return { suggestions, summary }
  }
}
