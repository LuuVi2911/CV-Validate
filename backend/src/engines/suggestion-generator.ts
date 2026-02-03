import { Injectable } from '@nestjs/common'
import type { CvSectionType } from 'src/generated/prisma/enums'
import type { Gap } from './gap-detector'
import type { RuleEvaluationResult } from './semantic/semantic-evaluator'
import { GapSeverity } from './similarity/similarity.contract'

/**
 * SUGGESTION GENERATOR
 *
 * Generates deterministic, actionable suggestions based on gaps and partial matches.
 * Uses short "concept labels" extracted from rule chunks.
 */

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
  conceptLabel: string
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

@Injectable()
export class SuggestionGenerator {
  generateFromGaps(gaps: Gap[]): SuggestionResult {
    const suggestions: Suggestion[] = []
    let counter = 0

    for (const gap of gaps) {
      if (gap.severity === 'NONE') continue

      counter++
      suggestions.push(this.createSuggestionFromGap(gap, counter))
    }

    return this.buildSummary(suggestions)
  }

  generateFromEvaluationResults(results: RuleEvaluationResult[]): SuggestionResult {
    const suggestions: Suggestion[] = []
    let counter = 0

    for (const result of results) {
      if (result.result !== 'PARTIAL') continue

      for (const chunkEvidence of result.chunkEvidence) {
        if (chunkEvidence.bestBand !== 'AMBIGUOUS') continue

        counter++
        suggestions.push(this.createSuggestionForPartial(
          result.ruleId,
          result.ruleKey,
          chunkEvidence.ruleChunkId,
          chunkEvidence.ruleChunkContent,
          chunkEvidence.bestCandidate?.cvChunkId ?? null,
          chunkEvidence.bestCandidate?.sectionType as CvSectionType ?? null,
          chunkEvidence.bestCandidate?.snippet ?? null,
          counter,
        ))
      }
    }

    return this.buildSummary(suggestions)
  }

  mergeSuggestions(
    gapSuggestions: SuggestionResult,
    evalSuggestions: SuggestionResult,
  ): SuggestionResult {
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
      severity: 'ADVISORY', // Use ADVISORY for PARTIAL matches
      type: 'PARTIAL',
      message,
      targetCvChunkId,
      sectionType,
      evidenceSnippet,
      suggestedActionType: actionType,
      conceptLabel,
    }
  }

  private extractConceptLabel(content: string): string {
    if (content.length <= 40) return content.trim()

    const noise = new Set([
      ...STOPWORDS,
      'company', 'industry', 'requirements', 'qualifications', 'responsibilities',
      'skills', 'experience', 'candidate', 'ideal', 'expected', 'minimum',
      'plus', 'basic', 'strong', 'solid', 'demonstrated', 'proven',
    ])

    const tokens = content
      .toLowerCase()
      .replace(/[^a-z0-9\s/]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !noise.has(t))

    const freq = new Map<string, number>()
    tokens.forEach(t => freq.set(t, (freq.get(t) || 0) + 1))

    const sorted = Array.from(freq.keys())
      .sort((a, b) => {
        const diff = freq.get(b)! - freq.get(a)!
        return diff !== 0 ? diff : a.localeCompare(b)
      })
      .slice(0, 3)

    return sorted.length > 0 ? sorted.join(' ') : content.slice(0, 40).trim()
  }

  private determineActionType(gap: Gap, isMissing: boolean): SuggestionActionType {
    if (isMissing || !gap.bestCvChunkId) {
      const content = gap.ruleChunkContent.toLowerCase()
      if (content.includes('metric') || content.includes('number') || content.includes('quantif')) {
        return 'ADD_METRIC'
      }
      if (content.includes('link') || content.includes('url') || content.includes('github') || content.includes('linkedin')) {
        return 'ADD_LINK'
      }
      return 'ADD_BULLET'
    }

    const content = gap.ruleChunkContent.toLowerCase()
    if (content.includes('metric') || content.includes('result') || content.includes('outcome')) {
      return 'ADD_METRIC'
    }

    return 'EXPAND_BULLET'
  }

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

    const hash = this.simpleHash(conceptLabel)
    const template = templates[hash % templates.length]

    return template.replace('{label}', conceptLabel)
  }

  private simpleHash(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return Math.abs(hash)
  }

  private buildSummary(suggestions: Suggestion[]): SuggestionResult {
    return {
      suggestions,
      summary: {
        total: suggestions.length,
        addBullet: suggestions.filter((s) => s.suggestedActionType === 'ADD_BULLET').length,
        expandBullet: suggestions.filter((s) => s.suggestedActionType === 'EXPAND_BULLET').length,
        addMetric: suggestions.filter((s) => s.suggestedActionType === 'ADD_METRIC').length,
        addLink: suggestions.filter((s) => s.suggestedActionType === 'ADD_LINK').length,
      }
    }
  }
}
