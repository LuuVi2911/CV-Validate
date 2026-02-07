import { Injectable } from '@nestjs/common'
import { GoogleGenerativeAI } from '@google/generative-ai'
import envConfig from '../config'
import { LoggerService } from './logger.service'

export enum RuleIntent {
  REQUIREMENT = 'REQUIREMENT',
  RESPONSIBILITY = 'RESPONSIBILITY',
  QUALIFICATION = 'QUALIFICATION',
  INFORMATIONAL = 'INFORMATIONAL',
  PREFERENCE = 'PREFERENCE',
}

export interface JdRuleForClassification {
  id: string
  content: string
}

/**
 * JD Rule Intent Classifier
 *
 * Classifies JD rules by intent to enable smart filtering:
 * - REQUIREMENT: Technical skills, experience (MATCH)
 * - RESPONSIBILITY: Job duties (MATCH)
 * - QUALIFICATION: Education, certs (MATCH)
 * - INFORMATIONAL: Benefits, culture (FILTER OUT)
 * - PREFERENCE: Nice-to-have (MATCH with lower weight)
 */
@Injectable()
export class JdRuleIntentClassifier {
  private genAI: GoogleGenerativeAI | null = null
  private readonly model = 'gemini-2.0-flash'

  constructor(private readonly logger: LoggerService) {
    if (envConfig.GEMINI_API_KEY) {
      this.genAI = new GoogleGenerativeAI(envConfig.GEMINI_API_KEY)
    }
  }

  /**
   * Classify a single rule's intent
   */
  async classifyIntent(ruleContent: string): Promise<RuleIntent> {
    if (!this.genAI) {
      this.logger.logWarning('Gemini API not configured, defaulting to REQUIREMENT')
      return RuleIntent.REQUIREMENT
    }

    try {
      const model = this.genAI.getGenerativeModel({ model: this.model })

      const prompt = `Classify this job description rule into ONE category:

REQUIREMENT - Must-have technical skills, years of experience, required qualifications
Examples: "5+ years Python", "React expertise", "AWS experience required"

RESPONSIBILITY - What the person will do in this role, job duties
Examples: "Design and implement features", "Lead team meetings", "Collaborate with designers"

QUALIFICATION - Education requirements, certifications, licenses
Examples: "BS in Computer Science", "AWS certification", "Valid driver's license"

INFORMATIONAL - Company benefits, culture, perks, company description, location, working style (NOT matchable against CV)
Examples: "Health insurance", "Flexible hours", "Fast-paced startup", "We are a leading fintech", "New York based", "Remote eligible", "Hybrid work"

PREFERENCE - Nice-to-have skills, bonus qualifications
Examples: "Startup experience preferred", "Familiarity with Docker is a plus"

Rule to classify:
"${ruleContent}"

Return ONLY the category name: REQUIREMENT, RESPONSIBILITY, QUALIFICATION, INFORMATIONAL, or PREFERENCE`

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 20,
        },
      })

      // Log token usage
      const usage = result.response.usageMetadata
      if (usage) {
        this.logger.logTokenUsage({
          service: 'JdRuleIntentClassifier',
          operation: 'classifyIntent',
          inputTokens: usage.promptTokenCount,
          outputTokens: usage.candidatesTokenCount,
          totalTokens: usage.totalTokenCount,
          model: this.model,
        })
      }

      const responseText = result.response.text().trim().toUpperCase()

      // Parse response
      if (responseText.includes('REQUIREMENT')) return RuleIntent.REQUIREMENT
      if (responseText.includes('RESPONSIBILITY')) return RuleIntent.RESPONSIBILITY
      if (responseText.includes('QUALIFICATION')) return RuleIntent.QUALIFICATION
      if (responseText.includes('INFORMATIONAL')) return RuleIntent.INFORMATIONAL
      if (responseText.includes('PREFERENCE')) return RuleIntent.PREFERENCE

      // Default to REQUIREMENT if unclear
      this.logger.logWarning('Could not parse intent, defaulting to REQUIREMENT', {
        response: responseText,
        ruleContent,
      })
      return RuleIntent.REQUIREMENT
    } catch (error) {
      this.logger.logError(error as Error, {
        service: 'JdRuleIntentClassifier',
        operation: 'classifyIntent',
      })
      // Safe default: treat as requirement
      return RuleIntent.REQUIREMENT
    }
  }

  /**
   * Classify multiple rules in batches for efficiency
   */
  async classifyBatch(rules: JdRuleForClassification[]): Promise<Map<string, RuleIntent>> {
    if (!this.genAI) {
      this.logger.logWarning('Gemini API not configured, defaulting all to REQUIREMENT')
      const results = new Map<string, RuleIntent>()
      rules.forEach((rule) => results.set(rule.id, RuleIntent.REQUIREMENT))
      return results
    }

    const results = new Map<string, RuleIntent>()
    const BATCH_SIZE = 10 // Process 10 rules at a time

    for (let i = 0; i < rules.length; i += BATCH_SIZE) {
      const batch = rules.slice(i, i + BATCH_SIZE)

      try {
        const model = this.genAI.getGenerativeModel({ model: this.model })

        const prompt = this.buildBatchPrompt(batch)

        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 500,
            responseMimeType: 'application/json',
          },
        })

        // Log token usage
        const usage = result.response.usageMetadata
        if (usage) {
          this.logger.logTokenUsage({
            service: 'JdRuleIntentClassifier',
            operation: 'classifyBatch',
            inputTokens: usage.promptTokenCount,
            outputTokens: usage.candidatesTokenCount,
            totalTokens: usage.totalTokenCount,
            model: this.model,
          })
        }

        const responseText = result.response.text()
        const parsed = this.parseBatchResponse(responseText, batch)

        // Merge results
        parsed.forEach((intent, id) => results.set(id, intent))
      } catch (error) {
        this.logger.logError(error as Error, {
          service: 'JdRuleIntentClassifier',
          operation: 'classifyBatch',
          batchSize: batch.length,
        })

        // Default failed batch to REQUIREMENT
        batch.forEach((rule) => results.set(rule.id, RuleIntent.REQUIREMENT))
      }
    }

    return results
  }

  /**
   * Build prompt for batch classification
   */
  private buildBatchPrompt(rules: JdRuleForClassification[]): string {
    const rulesList = rules.map((rule, idx) => `${idx + 1}. "${rule.content}"`).join('\n')

    return `Classify each of these job description rules:

Categories:
- REQUIREMENT: Must-have technical skills, years of experience
- RESPONSIBILITY: Job duties, what the person will do
- QUALIFICATION: Education, certifications, licenses
- INFORMATIONAL: Company benefits, culture, perks, location, working style (NOT matchable)
- PREFERENCE: Nice-to-have skills

Rules:
${rulesList}

Return a JSON array with classifications:
[
  {"index": 1, "intent": "REQUIREMENT"},
  {"index": 2, "intent": "INFORMATIONAL"},
  ...
]`
  }

  /**
   * Parse batch classification response
   */
  private parseBatchResponse(responseText: string, rules: JdRuleForClassification[]): Map<string, RuleIntent> {
    const results = new Map<string, RuleIntent>()

    try {
      const parsed = JSON.parse(responseText)

      if (Array.isArray(parsed)) {
        parsed.forEach((item: any) => {
          const index = item.index - 1 // Convert 1-indexed to 0-indexed
          if (index >= 0 && index < rules.length) {
            const rule = rules[index]
            const intent = this.parseIntentString(item.intent)
            results.set(rule.id, intent)
          }
        })
      }
    } catch (error) {
      this.logger.logError(error as Error, {
        service: 'JdRuleIntentClassifier',
        operation: 'parseBatchResponse',
      })
    }

    // Fill in any missing with default
    rules.forEach((rule) => {
      if (!results.has(rule.id)) {
        results.set(rule.id, RuleIntent.REQUIREMENT)
      }
    })

    return results
  }

  /**
   * Parse intent string to enum
   */
  private parseIntentString(intentStr: string): RuleIntent {
    const normalized = intentStr.toUpperCase()

    if (normalized.includes('REQUIREMENT')) return RuleIntent.REQUIREMENT
    if (normalized.includes('RESPONSIBILITY')) return RuleIntent.RESPONSIBILITY
    if (normalized.includes('QUALIFICATION')) return RuleIntent.QUALIFICATION
    if (normalized.includes('INFORMATIONAL')) return RuleIntent.INFORMATIONAL
    if (normalized.includes('PREFERENCE')) return RuleIntent.PREFERENCE

    return RuleIntent.REQUIREMENT
  }

  /**
   * Check if a rule intent should be included in matching
   */
  static shouldIncludeInMatching(intent: RuleIntent | null): boolean {
    if (!intent) return true // Include if not classified yet

    // Exclude INFORMATIONAL rules
    return intent !== RuleIntent.INFORMATIONAL
  }

  /**
   * Get weight multiplier for an intent
   */
  static getIntentWeight(intent: RuleIntent | null): number {
    if (!intent) return 1.0

    switch (intent) {
      case RuleIntent.REQUIREMENT:
        return 1.0
      case RuleIntent.QUALIFICATION:
        return 1.0
      case RuleIntent.RESPONSIBILITY:
        return 0.8
      case RuleIntent.PREFERENCE:
        return 0.5
      case RuleIntent.INFORMATIONAL:
        return 0.0 // Should be filtered out
      default:
        return 1.0
    }
  }
}
