import { Injectable } from '@nestjs/common'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { PrismaService } from './prisma.service'
import type { RuleType } from 'src/generated/prisma/enums'
import envConfig from '../config'

interface SimilarReferenceRule {
    id: string
    category: RuleType
    title: string
    description: string
    similarity: number
}

/**
 * JD Rule Classifier Service
 * 
 * Classifies extracted JD rules into MUST_HAVE, NICE_TO_HAVE, or BEST_PRACTICE
 * using semantic similarity against reference rules from the Match JD rules PDF.
 * 
 * Classification Strategy:
 * 1. Embed the JD rule text
 * 2. Find top-3 similar reference rules using cosine similarity
 * 3. If HIGH similarity (>= 0.8): Use reference rule category
 * 4. If AMBIGUOUS (>= 0.5): Delegate to LLM classifier
 * 5. If LOW (< 0.5): Fallback to keyword detection
 */
@Injectable()
export class JdRuleClassifierService {
    private genAI: GoogleGenerativeAI | null = null

    constructor(
        private readonly prisma: PrismaService,
    ) {
        if (envConfig.GEMINI_API_KEY) {
            this.genAI = new GoogleGenerativeAI(envConfig.GEMINI_API_KEY)
        }
    }

    async classifyRule(ruleText: string): Promise<RuleType> {
        // If embeddings are disabled, fallback to keyword classification
        if (!this.genAI) {
            return this.fallbackKeywordClassification(ruleText)
        }

        // 1. Embed the rule text
        const model = this.genAI.getGenerativeModel({ model: envConfig.EMBEDDING_MODEL })
        const result = await model.embedContent(ruleText)
        const embedding = result.embedding.values

        // 2. Find top-3 similar reference rules
        const similarRules = await this.findSimilarReferenceRules(embedding, 3)

        if (similarRules.length === 0) {
            // No reference rules in database - fallback to keyword detection
            return this.fallbackKeywordClassification(ruleText)
        }

        const bestMatch = similarRules[0]

        // 3. High confidence - use reference rule category
        if (bestMatch.similarity >= 0.8) {
            return bestMatch.category
        }

        // 4. Ambiguous - would use LLM judge (for now, use weighted voting)
        if (bestMatch.similarity >= 0.5) {
            return this.weightedVoting(similarRules)
        }

        // 5. Low similarity - fallback to keywords
        return this.fallbackKeywordClassification(ruleText)
    }

    /**
     * Find similar reference rules using pgvector cosine similarity
     */
    private async findSimilarReferenceRules(
        embedding: number[],
        topK: number,
    ): Promise<SimilarReferenceRule[]> {
        const embeddingString = `[${embedding.join(',')}]`

        const results = await this.prisma.$queryRaw<
            Array<{
                id: string
                category: RuleType
                title: string
                description: string
                similarity: number
            }>
        >`
      SELECT
        id,
        category,
        title,
        description,
        1 - (embedding <=> ${embeddingString}::vector) as similarity
      FROM "ReferenceRule"
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> ${embeddingString}::vector ASC
      LIMIT ${topK}
    `

        return results.map((r) => ({
            id: r.id,
            category: r.category,
            title: r.title,
            description: r.description,
            similarity: Number(r.similarity),
        }))
    }

    /**
     * Weighted voting based on similarity scores
     */
    private weightedVoting(similarRules: SimilarReferenceRule[]): RuleType {
        const weights: Record<RuleType, number> = {
            MUST_HAVE: 0,
            NICE_TO_HAVE: 0,
            BEST_PRACTICE: 0,
        }

        for (const rule of similarRules) {
            weights[rule.category] += rule.similarity
        }

        // Return category with highest weighted score
        const entries = Object.entries(weights) as [RuleType, number][]
        entries.sort((a, b) => b[1] - a[1])
        return entries[0][0]
    }

    /**
     * Fallback keyword-based classification
     */
    private fallbackKeywordClassification(ruleText: string): RuleType {
        const lowerText = ruleText.toLowerCase()

        const mustHaveKeywords = ['must', 'required', 'need to', 'minimum', 'mandatory', 'essential']
        const niceToHaveKeywords = ['nice to have', 'preferred', 'plus', 'bonus', 'advantage', 'desirable', 'ideally']

        if (mustHaveKeywords.some((kw) => lowerText.includes(kw))) {
            return 'MUST_HAVE'
        }

        if (niceToHaveKeywords.some((kw) => lowerText.includes(kw))) {
            return 'NICE_TO_HAVE'
        }

        // Default to BEST_PRACTICE if no keywords match
        return 'BEST_PRACTICE'
    }
}
