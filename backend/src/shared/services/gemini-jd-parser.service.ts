import { Injectable } from '@nestjs/common'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { RuleType } from 'src/generated/prisma/enums'
import envConfig from '../config'
import { LoggerService } from './logger.service'

export interface ParsedJdRule {
  category: RuleType
  title: string
  content: string
  chunks: string[]
  ignored?: boolean
}

export interface JdParseResult {
  rules: ParsedJdRule[]
  metadata: {
    totalRules: number
    mustHave: number
    niceToHave: number
    bestPractice: number
  }
}

/**
 * GeminiJdParserService - Smart JD Parsing
 *
 * Purpose: Transform raw JD text into structured, categorized rules
 * using LLM understanding instead of regex splitting.
 *
 * Output Format:
 * - Category-based grouping (MUST_HAVE, NICE_TO_HAVE, BEST_PRACTICE)
 * - Synthesized requirements (e.g., "Core Technical Skills")
 * - Atomic chunks for matching
 */
@Injectable()
export class GeminiJdParserService {
  private genAI: GoogleGenerativeAI | null = null
  private readonly model = 'gemini-2.5-flash-lite'

  constructor(private readonly logger: LoggerService) {
    if (envConfig.GEMINI_API_KEY) {
      this.genAI = new GoogleGenerativeAI(envConfig.GEMINI_API_KEY)
    }
  }

  /**
   * Parse JD text into structured rules using LLM
   */
  async parseJd(jdText: string): Promise<JdParseResult> {
    if (!this.genAI) {
      throw new Error('Gemini API not configured')
    }

    const model = this.genAI.getGenerativeModel({ model: this.model })

    const prompt = this.buildPrompt(jdText)

    try {
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
        },
      })

      // Log token usage
      const usage = result.response.usageMetadata
      if (usage) {
        this.logger.logTokenUsage({
          service: 'GeminiJdParserService',
          operation: 'parseJd',
          inputTokens: usage.promptTokenCount,
          outputTokens: usage.candidatesTokenCount,
          totalTokens: usage.totalTokenCount,
          model: this.model,
        })
      }

      const responseText = result.response.text()
      return this.parseResponse(responseText)
    } catch (error) {
      this.logger.logError(error as Error, {
        service: 'GeminiJdParserService',
        operation: 'parseJd',
      })
      throw error
    }
  }

  /**
   * Build the parsing prompt
   */
  private buildPrompt(jdText: string): string {
    return `You are a JD (Job Description) parser. Your task is to extract structured requirements from raw JD text.

JD TEXT:
"""
${jdText}
"""

INSTRUCTIONS:
1. Extract requirements and categorize them into:
   - MUST_HAVE: Core technical skills, required experience, mandatory qualifications
   - NICE_TO_HAVE: Preferred skills, bonus qualifications, desirable experience
   - BEST_PRACTICE: Soft skills, learning signals, cultural fit indicators

2. For each requirement, provide:
   - category: "MUST_HAVE" | "NICE_TO_HAVE" | "BEST_PRACTICE"
   - title: A concise, descriptive title (e.g., "Core Technical Skills", "Practical Usage Evidence")
   - content: A synthesized summary of the requirement (1-2 sentences)
   - chunks: An array of atomic concepts/skills (e.g., ["JavaScript", "TypeScript", "React"])
   - ignored: (Optional boolean) Set to true for Location, Working Style, or Availability

3. SPECIAL INSTRUCTION: Extract the following but mark them as "ignored: true":
   - Location requirements (e.g., "Must be based in New York", "Relocation assistance provided")
   - Working Style (e.g., "Remote", "Hybrid", "On-site", "Flexible hours")
   - Availability / Duration (e.g., "Full-time", "Available immediately", "6-month contract", "37.5 hours per week")

4. IGNORE the following (do NOT create rules for these at all):
   - Company culture descriptions
   - Benefits and perks (salary, healthcare, team events)
   - Application process details
   - Phrases like "potential offer", "intern certificate"

5. Group similar skills together -> Create CONCRETE rules
   - BAD: "Technologies", "Methods", "Tools"
   - GOOD: "Web Technologies", "Testing Methods", "DevOps Tools"
   - If a requirement lists multiple specific tools (e.g. React, Node, AWS), keep them as a cohesive unit like "Full Stack Web Technologies" if appropriate.

6. Keep chunks atomic and matchable (e.g., "React" not "experience with React")

Respond with a JSON object in this exact format:
{
  "rules": [
    {
      "category": "MUST_HAVE",
      "title": "Core Technical Skills",
      "content": "Familiarity with JavaScript (ES6+), TypeScript, and React for frontend development",
      "chunks": ["JavaScript", "ES6+", "TypeScript", "React"]
    },
    {
      "category": "MUST_HAVE",
      "title": "Backend Development",
      "content": "Knowledge of Node.js and RESTful API development",
      "chunks": ["Node.js", "RESTful APIs", "API development"]
    }
  ]
}`
  }

  /**
   * Parse and validate the LLM response
   */
  private parseResponse(responseText: string): JdParseResult {
    try {
      // Use regex to find the JSON object
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      const cleanText = jsonMatch ? jsonMatch[0] : responseText.trim()

      const parsed = JSON.parse(cleanText)

      if (!parsed.rules || !Array.isArray(parsed.rules)) {
        throw new Error('Invalid response format: missing rules array')
      }

      // Validate and normalize each rule
      const rules: ParsedJdRule[] = parsed.rules.map((rule: any) => ({
        category: this.normalizeCategory(rule.category),
        title: String(rule.title || 'Untitled Requirement'),
        content: String(rule.content || ''),
        chunks: Array.isArray(rule.chunks) ? rule.chunks.map(String) : [],
        ignored: !!rule.ignored,
      }))

      // Calculate metadata
      const metadata = {
        totalRules: rules.length,
        mustHave: rules.filter((r) => r.category === 'MUST_HAVE').length,
        niceToHave: rules.filter((r) => r.category === 'NICE_TO_HAVE').length,
        bestPractice: rules.filter((r) => r.category === 'BEST_PRACTICE').length,
      }

      return { rules, metadata }
    } catch (error) {
      this.logger.logError(error as Error, {
        service: 'GeminiJdParserService',
        operation: 'parseResponse',
      })
      throw new Error('Failed to parse JD response')
    }
  }

  /**
   * Normalize category to valid RuleType
   */
  private normalizeCategory(value: unknown): RuleType {
    if (typeof value === 'string') {
      const upper = value.toUpperCase()
      if (upper === 'MUST_HAVE' || upper === 'MUST-HAVE' || upper === 'MUSTHAVE') return 'MUST_HAVE'
      if (upper === 'NICE_TO_HAVE' || upper === 'NICE-TO-HAVE' || upper === 'NICETOHAVE') return 'NICE_TO_HAVE'
      if (upper === 'BEST_PRACTICE' || upper === 'BEST-PRACTICE' || upper === 'BESTPRACTICE') return 'BEST_PRACTICE'
    }
    // Default to BEST_PRACTICE if unclear
    return 'BEST_PRACTICE'
  }

  /**
   * Check if the parser is enabled and available
   */
  isEnabled(): boolean {
    return this.genAI !== null
  }
}
