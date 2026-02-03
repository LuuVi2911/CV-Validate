import { Injectable } from '@nestjs/common'
import { GoogleGenerativeAI } from '@google/generative-ai'
import envConfig from '../config'

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

  constructor() {
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

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0, // Deterministic output
          maxOutputTokens: 256,
          responseMimeType: 'application/json',
        },
      })

      const responseText = result.response.text()
      const parsedResult = this.parseResponse(responseText)

      return {
        used: true,
        skipped: false,
        result: parsedResult,
        model: this.model,
        latencyMs: Date.now() - startTime,
      }
    } catch (error) {
      console.error('Gemini judge error:', error)
      // Degrade gracefully - mark as skipped
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
  "reason": "Brief explanation (max 50 words)",
  "confidence": "low" or "medium" or "high"
}

Rules for relevance:
- "relevant": true if the CV content demonstrates skills, experience, or knowledge that matches the requirement
- "relevant": false if there's no clear connection between the CV content and the requirement`
  }

  /**
   * Parse the response and validate the schema
   */
  private parseResponse(responseText: string): JudgeResult {
    try {
      // Clean the response (remove markdown code blocks if present)
      let cleanText = responseText.trim()
      if (cleanText.startsWith('```json')) {
        cleanText = cleanText.replace(/^```json\n?/, '').replace(/\n?```$/, '')
      } else if (cleanText.startsWith('```')) {
        cleanText = cleanText.replace(/^```\n?/, '').replace(/\n?```$/, '')
      }

      const parsed = JSON.parse(cleanText)

      // Validate and normalize the response
      const relevant = Boolean(parsed.relevant)
      const reason = String(parsed.reason || 'No reason provided').substring(0, 200)
      const confidence = this.normalizeConfidence(parsed.confidence)

      return { relevant, reason, confidence }
    } catch (error) {
      // If parsing fails, default to not relevant (conservative)
      return {
        relevant: false,
        reason: 'Failed to parse judge response',
        confidence: 'low',
      }
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
