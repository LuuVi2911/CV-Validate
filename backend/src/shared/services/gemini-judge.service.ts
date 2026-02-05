import { Injectable } from '@nestjs/common'
import { GoogleGenerativeAI } from '@google/generative-ai'
import envConfig from '../config'
import { LoggerService } from './logger.service'

export interface JudgeInput {
  ruleChunkContent: string
  cvChunkContent: string
  sectionType: string
}

export interface JudgeResult {
  relevant: boolean
  reason: string
  confidence: 'low' | 'medium' | 'high'
}

export interface JudgeResponse {
  used: boolean
  skipped: boolean
  result: JudgeResult | null
  model: string | null
  latencyMs: number
}

/**
 * GeminiJudgeService - Stage 14
 *
 * Purpose: Resolve AMBIGUOUS similarity cases only, without affecting
 * CV quality result or deterministic scoring rules.
 *
 * Allowed logic:
 * - Only adjudication of AMBIGUOUS relevance (binary or constrained outputs)
 * - If unavailable/timeout → deterministic degradation: treat as LOW
 *
 * Forbidden logic:
 * - Judge deciding CV readiness
 * - Judge influencing thresholds or scoring weights
 * - Judge generating suggestions/rewrite content
 *
 * Output: Strict JSON object with deterministic mapping
 */
@Injectable()
export class GeminiJudgeService {
  private genAI: GoogleGenerativeAI | null = null
  private readonly model = 'gemini-2.5-flash'

  constructor(private readonly logger: LoggerService) {
    if (envConfig.GEMINI_API_KEY) {
      this.genAI = new GoogleGenerativeAI(envConfig.GEMINI_API_KEY)
    }
  }

  /**
   * Judge whether a CV chunk is relevant to a JD rule chunk
   *
   * @param input The JD rule chunk and CV chunk to compare
   * @returns JudgeResponse with result or skipped=true if unavailable
   */
  async judge(input: JudgeInput): Promise<JudgeResponse> {
    const startTime = Date.now()

    // Check if judge is enabled and available
    if (!envConfig.LLM_JUDGE_ENABLED || !this.genAI) {
      return {
        used: false,
        skipped: true,
        result: null,
        model: null,
        latencyMs: Date.now() - startTime,
      }
    }

    try {
      const model = this.genAI.getGenerativeModel({ model: this.model })

      const prompt = this.buildPrompt(input)

      const result = await this.callWithRetry(async () => {
        const stream = await model.generateContentStream({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0, // Deterministic output
            maxOutputTokens: 1024, // Increased to prevent MAX_TOKENS truncation
          },
        })

        // Collect all chunks from the stream
        let fullText = ''
        for await (const chunk of stream.stream) {
          const chunkText = chunk.text()
          fullText += chunkText
        }

        // Get the final response with metadata
        const response = await stream.response
        return { response, fullText }
      })

      // Log token usage
      const usage = result.response.usageMetadata
      if (usage) {
        this.logger.logTokenUsage({
          service: 'GeminiJudgeService',
          operation: 'judge',
          inputTokens: usage.promptTokenCount,
          outputTokens: usage.candidatesTokenCount,
          totalTokens: usage.totalTokenCount,
          model: this.model,
        })
      }

      const parsedResult = this.parseResponse(result.fullText)

      return {
        used: true,
        skipped: false,
        result: parsedResult,
        model: this.model,
        latencyMs: Date.now() - startTime,
      }
    } catch (error) {
      // Log error but don't throw - degrade gracefully
      this.logger.logError(error as Error, {
        service: 'GeminiJudgeService',
        operation: 'judge',
      })
      return {
        used: false,
        skipped: true,
        result: null,
        model: this.model,
        latencyMs: Date.now() - startTime,
      }
    }
  }

  /**
   * Judge multiple comparisons in a single batch API call
   * Reduces API calls and improves rate limit handling
   *
   * @param inputs Array of comparisons to judge
   * @returns Array of judge responses in same order as inputs
   */
  async judgeBatch(inputs: JudgeInput[]): Promise<JudgeResponse[]> {
    const startTime = Date.now()

    // Check if judge is enabled and available
    if (!envConfig.LLM_JUDGE_ENABLED || !this.genAI) {
      return inputs.map(() => ({
        used: false,
        skipped: true,
        result: null,
        model: null,
        latencyMs: 0,
      }))
    }

    if (inputs.length === 0) {
      return []
    }

    try {
      const model = this.genAI.getGenerativeModel({ model: this.model })

      const prompt = this.buildBatchPrompt(inputs)

      const result = await this.callWithRetry(async () => {
        const stream = await model.generateContentStream({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 2048, // Larger for batch responses
          },
        })

        // Collect all chunks from the stream
        let fullText = ''
        for await (const chunk of stream.stream) {
          const chunkText = chunk.text()
          fullText += chunkText
        }

        // Get the final response with metadata
        const response = await stream.response
        return { response, fullText }
      })

      // Log token usage
      const usage = result.response.usageMetadata
      if (usage) {
        this.logger.logTokenUsage({
          service: 'GeminiJudgeService',
          operation: 'judgeBatch',
          inputTokens: usage.promptTokenCount,
          outputTokens: usage.candidatesTokenCount,
          totalTokens: usage.totalTokenCount,
          model: this.model,
        })
      }

      const parsedResults = this.parseBatchResponse(result.fullText, inputs.length)

      const latencyMs = Date.now() - startTime

      return parsedResults.map((result) => ({
        used: true,
        skipped: false,
        result,
        model: this.model,
        latencyMs,
      }))
    } catch (error) {
      console.error('Gemini batch judge error:', error)
      // Degrade gracefully - mark all as skipped
      return inputs.map(() => ({
        used: false,
        skipped: true,
        result: null,
        model: this.model,
        latencyMs: Date.now() - startTime,
      }))
    }
  }

  /**
   * Retry logic with exponential backoff for rate limits
   */
  private async callWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn()
      } catch (error: any) {
        const isRateLimit = error?.status === 429 || error?.message?.includes('429')
        const shouldRetry = isRateLimit && i < maxRetries - 1

        if (shouldRetry) {
          const delay = Math.pow(2, i) * 1000 // 1s, 2s, 4s
          console.log(`Rate limit hit, retrying in ${delay}ms (attempt ${i + 1}/${maxRetries})`)
          await new Promise((resolve) => setTimeout(resolve, delay))
          continue
        }
        throw error
      }
    }
    throw new Error('Max retries exceeded')
  }

  /**
   * Build the prompt for the judge
   * Strict instructions: judge relevance only
   */
  private buildPrompt(input: JudgeInput): string {
    return `You are a CV-JD matching judge. Your ONLY task is to determine if the CV content demonstrates the requirement specified in the JD.

JD REQUIREMENT:
"${input.ruleChunkContent}"

CV CONTENT (from ${input.sectionType} section):
"${input.cvChunkContent}"

INSTRUCTIONS:
- Answer ONLY whether the CV content demonstrates or relates to the JD requirement
- Do NOT evaluate CV quality
- Do NOT suggest improvements
- Do NOT make hiring decisions

Respond with a JSON object in this exact format:
{
  "relevant": true or false,
  "reason": "Brief explanation (max 25 words)",
  "confidence": "low" or "medium" or "high"
}

Rules for relevance:
- "relevant": true if the CV content demonstrates skills, experience, or knowledge that matches the requirement
- "relevant": false if there's no clear connection between the CV content and the requirement`
  }

  /**
   * Build batch prompt for multiple comparisons
   */
  private buildBatchPrompt(inputs: JudgeInput[]): string {
    const comparisons = inputs
      .map(
        (input, idx) => `
COMPARISON ${idx}:
JD REQUIREMENT: "${input.ruleChunkContent}"
CV CONTENT (from ${input.sectionType}): "${input.cvChunkContent}"
`,
      )
      .join('\n')

    return `You are a CV-JD matching judge. Evaluate the following ${inputs.length} CV-JD requirement pairs.

${comparisons}

INSTRUCTIONS:
- For each comparison, determine if the CV content demonstrates the JD requirement
- Do NOT evaluate CV quality, suggest improvements, or make hiring decisions

Respond with a JSON array with ${inputs.length} objects in this exact format:
[
  {"id": 0, "relevant": true or false, "reason": "Brief explanation", "confidence": "low" or "medium" or "high"},
  {"id": 1, "relevant": true or false, "reason": "Brief explanation", "confidence": "low" or "medium" or "high"}
]

Rules:
- "relevant": true if CV demonstrates skills/experience matching the requirement
- "relevant": false if no clear connection
- Keep reasons under 50 words`
  }

  /**
   * Parse the response and validate the schema
   */
  private parseResponse(responseText: string): JudgeResult {
    try {
      // Clean the response (remove markdown code blocks if present)
      let cleanText = responseText.trim()

      // Try parsing directly first (for pure JSON responses)
      try {
        const parsed = JSON.parse(cleanText)
        if (parsed && typeof parsed === 'object') {
          // Validate and normalize the response
          const relevant = Boolean(parsed.relevant)
          const reason = String(parsed.reason || 'No reason provided').substring(0, 200)
          const confidence = this.normalizeConfidence(parsed.confidence)
          return { relevant, reason, confidence }
        }
      } catch {
        // Not pure JSON, try extracting it
      }

      // Use regex to find the JSON object { ... } (non-greedy)
      const jsonMatch = cleanText.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/)
      if (jsonMatch) {
        cleanText = jsonMatch[0]
      } else {
        // Fallback: try to clean markdown if regex didn't find a clear object
        if (cleanText.startsWith('```json')) {
          cleanText = cleanText.replace(/^```json\n?/, '').replace(/\n?```$/, '')
        } else if (cleanText.startsWith('```')) {
          cleanText = cleanText.replace(/^```\n?/, '').replace(/\n?```$/, '')
        }
      }

      const parsed = JSON.parse(cleanText)

      // Validate and normalize the response
      const relevant = Boolean(parsed.relevant)
      const reason = String(parsed.reason || 'No reason provided').substring(0, 200)
      const confidence = this.normalizeConfidence(parsed.confidence)

      return { relevant, reason, confidence }
    } catch (error) {
      // Log the actual response for debugging
      console.error('Failed to parse LLM judge response:', {
        responseText,
        error: error instanceof Error ? error.message : String(error),
      })

      // If parsing fails, default to not relevant (conservative)
      return {
        relevant: false,
        reason: 'Failed to parse judge response',
        confidence: 'low',
      }
    }
  }

  /**
   * Parse batch response (JSON array)
   */
  private parseBatchResponse(responseText: string, expectedCount: number): JudgeResult[] {
    try {
      // Clean the response
      let cleanText = responseText.trim()
      if (cleanText.startsWith('```json')) {
        cleanText = cleanText.replace(/^```json\n?/, '').replace(/\n?```$/, '')
      } else if (cleanText.startsWith('```')) {
        cleanText = cleanText.replace(/^```\n?/, '').replace(/\n?```$/, '')
      }

      const parsed = JSON.parse(cleanText)

      if (!Array.isArray(parsed)) {
        throw new Error('Response is not an array')
      }

      // Map and validate each result
      const results: JudgeResult[] = []
      for (let i = 0; i < expectedCount; i++) {
        const item = parsed.find((p) => p.id === i) || parsed[i]

        if (item) {
          results.push({
            relevant: Boolean(item.relevant),
            reason: String(item.reason || 'No reason provided').substring(0, 200),
            confidence: this.normalizeConfidence(item.confidence),
          })
        } else {
          // Missing result - default to not relevant
          results.push({
            relevant: false,
            reason: 'Missing result in batch response',
            confidence: 'low',
          })
        }
      }

      return results
    } catch (error) {
      console.error('Failed to parse batch response:', error)
      // Return default results for all inputs
      return Array(expectedCount).fill({
        relevant: false,
        reason: 'Failed to parse batch response',
        confidence: 'low',
      })
    }
  }

  /**
   * Normalize confidence value to valid enum
   */
  private normalizeConfidence(value: unknown): 'low' | 'medium' | 'high' {
    if (typeof value === 'string') {
      const lower = value.toLowerCase()
      if (lower === 'high') return 'high'
      if (lower === 'medium') return 'medium'
    }
    return 'low'
  }

  /**
   * Check if the judge is enabled and available
   */
  isEnabled(): boolean {
    return envConfig.LLM_JUDGE_ENABLED && this.genAI !== null
  }
}
