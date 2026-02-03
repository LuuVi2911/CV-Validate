import { Injectable } from '@nestjs/common'
import { createHash } from 'crypto'
import { PrismaService } from './prisma.service'
import { PdfTextService } from './pdf-text.service'
import { EmbeddingService } from './embedding.service'
import type { RuleType, RuleStrategy, RuleSeverity, CvSectionType } from 'src/generated/prisma/enums'
import envConfig from '../config'

/**
 * Rule Ingestion Service
 *
 * Purpose: Ingest rules from PDF files into the database deterministically.
 *
 * Pipeline:
 * 1. Extract text from PDF
 * 2. Split into rule blocks (headings, numbered items, bullets)
 * 3. Derive ruleKey, category, severity, strategy
 * 4. Create RuleSet → Rule → RuleChunk records
 * 5. Generate embeddings for rule chunks
 */

export interface ParsedRule {
  ruleKey: string
  category: RuleType
  severity: RuleSeverity
  strategy: RuleStrategy
  title: string | null
  content: string
  appliesToSections: CvSectionType[] | null
  structuralCheckKey: string | null
  params: Record<string, unknown> | null
  chunks: string[]
}

export interface IngestionResult {
  ruleSetId: string
  rulesCreated: number
  chunksCreated: number
  chunksEmbedded: number
}

@Injectable()
export class RuleIngestionService {
  // Max chunk length (characters)
  private readonly MAX_CHUNK_LENGTH = 300

  // Rule ID patterns (e.g., "Rule S-MH-01:", "S-NH-03 -", etc.)
  private readonly RULE_ID_PATTERN = /^(?:Rule\s+)?([A-Z]+-[A-Z]+-\d+)\s*[:\-—]?\s*/i

  // Category markers
  private readonly CATEGORY_MARKERS: Record<string, RuleType> = {
    'MUST_HAVE': 'MUST_HAVE',
    'MUST HAVE': 'MUST_HAVE',
    'MH': 'MUST_HAVE',
    'NICE_TO_HAVE': 'NICE_TO_HAVE',
    'NICE TO HAVE': 'NICE_TO_HAVE',
    'NH': 'NICE_TO_HAVE',
    'BEST_PRACTICE': 'BEST_PRACTICE',
    'BEST PRACTICE': 'BEST_PRACTICE',
    'BP': 'BEST_PRACTICE',
  }

  // Severity markers
  private readonly SEVERITY_MARKERS: Record<string, RuleSeverity> = {
    'critical': 'critical',
    'CRITICAL': 'critical',
    'required': 'critical',
    'REQUIRED': 'critical',
    'warning': 'warning',
    'WARNING': 'warning',
    'recommended': 'warning',
    'RECOMMENDED': 'warning',
    'info': 'info',
    'INFO': 'info',
    'optional': 'info',
    'OPTIONAL': 'info',
  }

  // Structural rule indicators (these rules use code-based detectors)
  private readonly STRUCTURAL_INDICATORS = [
    'email', 'phone', 'contact', 'linkedin', 'github', 'url', 'link',
    'date', 'section', 'presence', 'format', 'pattern', 'metric', 'number',
  ]

  // Section type keywords for appliesToSections
  private readonly SECTION_KEYWORDS: Record<string, CvSectionType[]> = {
    'experience': ['EXPERIENCE'],
    'work': ['EXPERIENCE'],
    'project': ['PROJECTS'],
    'skill': ['SKILLS'],
    'education': ['EDUCATION'],
    'activity': ['ACTIVITIES'],
    'summary': ['SUMMARY'],
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfTextService: PdfTextService,
    private readonly embeddingService: EmbeddingService,
  ) { }

  /**
   * Ingest rules from a PDF buffer
   */
  async ingestFromPdf(
    buffer: Buffer,
    ruleSetKey: string,
    sourcePdf: string,
    version: string,
  ): Promise<IngestionResult> {
    // Extract text from PDF
    const rawText = await this.pdfTextService.extractText(buffer)

    // Parse rules from text
    const rules = this.parseRules(rawText)

    // Create rule set and persist rules
    return this.persistRules(ruleSetKey, sourcePdf, version, rules)
  }

  /**
   * Ingest rules from raw text (for testing or direct input)
   */
  async ingestFromText(
    text: string,
    ruleSetKey: string,
    sourcePdf: string,
    version: string,
  ): Promise<IngestionResult> {
    const rules = this.parseRules(text)
    return this.persistRules(ruleSetKey, sourcePdf, version, rules)
  }

  /**
   * Parse rules from text deterministically
   */
  private parseRules(text: string): ParsedRule[] {
    const rules: ParsedRule[] = []
    const lines = text.split('\n')

    let currentRule: Partial<ParsedRule> | null = null
    let currentContent: string[] = []
    let order = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      // Check if this line starts a new rule (has rule ID pattern)
      const ruleIdMatch = line.match(this.RULE_ID_PATTERN)

      if (ruleIdMatch) {
        // Save previous rule if exists
        if (currentRule && currentRule.ruleKey) {
          rules.push(this.finalizeRule(currentRule, currentContent, order++))
        }

        // Start new rule
        const ruleKey = ruleIdMatch[1]
        const titlePart = line.slice(ruleIdMatch[0].length).trim()

        currentRule = {
          ruleKey,
          title: titlePart || null,
          category: this.inferCategory(ruleKey),
          severity: this.inferSeverity(ruleKey, titlePart),
          strategy: 'SEMANTIC', // default, may be overridden
        }
        currentContent = []
      } else if (currentRule) {
        // Add content to current rule
        currentContent.push(line)
      } else {
        // Check if this is a section header that defines category
        const categoryMatch = this.matchCategory(line)
        if (categoryMatch) {
          // This is a section header, skip it but remember context
          continue
        }

        // Try to create a rule from standalone numbered item
        const numberedMatch = line.match(/^(\d+)\.\s*(.+)/)
        if (numberedMatch) {
          const ruleKey = this.generateRuleKey(numberedMatch[2])
          currentRule = {
            ruleKey,
            title: numberedMatch[2],
            category: 'NICE_TO_HAVE', // default for unnumbered
            severity: 'info',
            strategy: 'SEMANTIC',
          }
          currentContent = []
        }
      }
    }

    // Don't forget last rule
    if (currentRule && currentRule.ruleKey) {
      rules.push(this.finalizeRule(currentRule, currentContent, order))
    }

    return rules
  }

  /**
   * Finalize a rule with its content
   */
  private finalizeRule(
    partial: Partial<ParsedRule>,
    contentLines: string[],
    _order: number,
  ): ParsedRule {
    const content = contentLines.join('\n').trim()
    const strategy = this.inferStrategy(partial.title || '', content)
    const appliesToSections = this.inferAppliesToSections(partial.title || '', content)
    const structuralCheckKey = strategy === 'STRUCTURAL' || strategy === 'HYBRID'
      ? this.inferStructuralCheckKey(partial.title || '', content)
      : null

    return {
      ruleKey: partial.ruleKey!,
      category: partial.category || 'NICE_TO_HAVE',
      severity: partial.severity || 'info',
      strategy,
      title: partial.title || null,
      content,
      appliesToSections,
      structuralCheckKey,
      params: null,
      chunks: this.chunkContent(content),
    }
  }

  /**
   * Infer category from rule key (e.g., S-MH-01 → MUST_HAVE)
   */
  private inferCategory(ruleKey: string): RuleType {
    if (ruleKey.includes('-MH-')) return 'MUST_HAVE'
    if (ruleKey.includes('-NH-')) return 'NICE_TO_HAVE'
    if (ruleKey.includes('-BP-')) return 'BEST_PRACTICE'
    return 'NICE_TO_HAVE'
  }

  /**
   * Infer severity from rule key and title
   */
  private inferSeverity(ruleKey: string, title: string): RuleSeverity {
    const combined = `${ruleKey} ${title}`.toLowerCase()

    // Check for explicit markers
    for (const [marker, severity] of Object.entries(this.SEVERITY_MARKERS)) {
      if (combined.includes(marker.toLowerCase())) {
        return severity
      }
    }

    // Infer from category
    if (ruleKey.includes('-MH-')) return 'critical'
    if (ruleKey.includes('-NH-')) return 'warning'
    if (ruleKey.includes('-BP-')) return 'info'

    return 'info'
  }

  /**
   * Infer strategy (STRUCTURAL, SEMANTIC, or HYBRID)
   */
  private inferStrategy(title: string, content: string): RuleStrategy {
    const combined = `${title} ${content}`.toLowerCase()

    let hasStructural = false
    let hasSemantic = false

    // Check for structural indicators
    for (const indicator of this.STRUCTURAL_INDICATORS) {
      if (combined.includes(indicator)) {
        hasStructural = true
        break
      }
    }

    // If it has substantial content beyond structural, it's semantic or hybrid
    if (content.length > 100) {
      hasSemantic = true
    }

    if (hasStructural && hasSemantic) return 'HYBRID'
    if (hasStructural) return 'STRUCTURAL'
    return 'SEMANTIC'
  }

  /**
   * Infer appliesToSections from content
   */
  private inferAppliesToSections(title: string, content: string): CvSectionType[] | null {
    const combined = `${title} ${content}`.toLowerCase()
    const sections = new Set<CvSectionType>()

    for (const [keyword, sectionTypes] of Object.entries(this.SECTION_KEYWORDS)) {
      if (combined.includes(keyword)) {
        for (const st of sectionTypes) {
          sections.add(st)
        }
      }
    }

    return sections.size > 0 ? Array.from(sections) : null
  }

  /**
   * Infer structural check key
   */
  private inferStructuralCheckKey(title: string, content: string): string | null {
    const combined = `${title} ${content}`.toLowerCase()

    if (combined.includes('email')) return 'email_present'
    if (combined.includes('phone')) return 'phone_present'
    if (combined.includes('linkedin')) return 'linkedin_present'
    if (combined.includes('github')) return 'github_present'
    if (combined.includes('date')) return 'date_present'
    if (combined.includes('section') && combined.includes('required')) return 'required_sections'
    if (combined.includes('metric') || combined.includes('number')) return 'metrics_present'

    return null
  }

  /**
   * Match category from line
   */
  private matchCategory(line: string): RuleType | null {
    const upper = line.toUpperCase()
    for (const [marker, category] of Object.entries(this.CATEGORY_MARKERS)) {
      if (upper.includes(marker)) {
        return category
      }
    }
    return null
  }

  /**
   * Generate a stable rule key from text
   */
  private generateRuleKey(text: string): string {
    const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50)
    const hash = createHash('sha256').update(text).digest('hex').slice(0, 8)
    return `AUTO-${normalized}-${hash}`
  }

  /**
   * Chunk content into ≤300 char pieces
   */
  private chunkContent(content: string): string[] {
    if (!content || content.length === 0) return []

    const chunks: string[] = []

    // First, try to split by bullets or numbered items
    const bulletLines = content.split(/\n(?=[-•*]|\d+\.)/)

    for (const segment of bulletLines) {
      const trimmed = segment.trim()
      if (!trimmed) continue

      if (trimmed.length <= this.MAX_CHUNK_LENGTH) {
        chunks.push(trimmed)
      } else {
        // Split long segments by sentences
        const sentences = trimmed.split(/(?<=[.!?])\s+/)
        let currentChunk = ''

        for (const sentence of sentences) {
          if (currentChunk.length + sentence.length + 1 <= this.MAX_CHUNK_LENGTH) {
            currentChunk += (currentChunk ? ' ' : '') + sentence
          } else {
            if (currentChunk) chunks.push(currentChunk)
            currentChunk = sentence.slice(0, this.MAX_CHUNK_LENGTH)
          }
        }

        if (currentChunk) chunks.push(currentChunk)
      }
    }

    return chunks.filter((c) => c.length > 10) // Filter out tiny chunks
  }

  /**
   * Persist rules to database
   */
  private async persistRules(
    ruleSetKey: string,
    sourcePdf: string,
    version: string,
    rules: ParsedRule[],
  ): Promise<IngestionResult> {
    // Delete existing rule set with same key (upsert behavior)
    await this.prisma.ruleSet.deleteMany({ where: { key: ruleSetKey } })

    // Create rule set
    const ruleSet = await this.prisma.ruleSet.create({
      data: {
        key: ruleSetKey,
        sourcePdf,
        version,
        embeddingProvider: 'gemini',
        embeddingModel: envConfig.EMBEDDING_MODEL,
        embeddingDimension: envConfig.EMBEDDING_DIM,
        vectorOperator: '<=>',
        similarityTransform: '1 - distance',
      },
    })

    let rulesCreated = 0
    let chunksCreated = 0

    // Create rules and chunks
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i]

      const createdRule = await this.prisma.cvQualityRule.create({
        data: {
          ruleSetId: ruleSet.id,
          ruleKey: rule.ruleKey,
          category: rule.category,
          severity: rule.severity,
          strategy: rule.strategy,
          title: rule.title,
          content: rule.content,
          appliesToSections: rule.appliesToSections as unknown as undefined,
          structuralCheckKey: rule.structuralCheckKey,
          params: rule.params as unknown as undefined,
          order: i,
        },
      })
      rulesCreated++

      // Create chunks
      for (let j = 0; j < rule.chunks.length; j++) {
        const chunkContent = rule.chunks[j]
        const chunkKey = this.generateChunkKey(rule.ruleKey, j, chunkContent)
        const contentHash = createHash('sha256').update(chunkContent).digest('hex')

        await this.prisma.cvQualityRuleChunk.create({
          data: {
            ruleId: createdRule.id,
            chunkKey,
            order: j,
            content: chunkContent,
            contentHash,
          },
        })
        chunksCreated++
      }
    }

    // Generate embeddings for all chunks
    const chunksEmbedded = await this.embedRuleChunks(ruleSet.id)

    return {
      ruleSetId: ruleSet.id,
      rulesCreated,
      chunksCreated,
      chunksEmbedded,
    }
  }

  /**
   * Generate stable chunk key
   */
  private generateChunkKey(ruleKey: string, order: number, content: string): string {
    const normalized = content.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20)
    const hash = createHash('sha256').update(`${ruleKey}-${order}-${content}`).digest('hex').slice(0, 8)
    return `${ruleKey}-${order}-${hash}`
  }

  /**
   * Embed all rule chunks for a rule set
   */
  private async embedRuleChunks(ruleSetId: string): Promise<number> {
    if (!this.embeddingService.isEnabled()) {
      return 0
    }

    // Find chunks without embeddings
    const chunks = await this.prisma.$queryRaw<Array<{ id: string; content: string }>>`
      SELECT c.id, c.content
      FROM "CvQualityRuleChunk" c
      JOIN "CvQualityRule" r ON r.id = c."ruleId"
      WHERE r."ruleSetId" = ${ruleSetId}
        AND c.embedding IS NULL
      ORDER BY r."order" ASC, c."order" ASC
    `

    if (chunks.length === 0) return 0

    let embedded = 0
    const batchSize = 100

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize)

      try {
        const embeddings = await this.generateEmbeddings(batch.map((c) => c.content))

        for (let j = 0; j < batch.length; j++) {
          const chunk = batch[j]
          const embedding = embeddings[j]
          const vectorString = `[${embedding.join(',')}]`

          await this.prisma.$executeRaw`
            UPDATE "CvQualityRuleChunk"
            SET embedding = ${vectorString}::vector
            WHERE id = ${chunk.id}
          `
          embedded++
        }
      } catch (error) {
        console.error('Error embedding rule chunks:', error)
      }
    }

    return embedded
  }

  /**
   * Generate embeddings using embedding service's API
   */
  private async generateEmbeddings(texts: string[]): Promise<number[][]> {
    // Access the private genAI from embedding service
    // For now, we'll use a direct implementation
    const { GoogleGenerativeAI } = await import('@google/generative-ai')

    if (!envConfig.GEMINI_API_KEY) {
      throw new Error('Gemini API key not configured')
    }

    const genAI = new GoogleGenerativeAI(envConfig.GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({ model: envConfig.EMBEDDING_MODEL })

    const embeddings: number[][] = []

    for (const text of texts) {
      const result = await model.embedContent(text)
      embeddings.push(result.embedding.values)
    }

    return embeddings
  }

  /**
   * Get all rules from a rule set
   */
  async getRulesByRuleSet(ruleSetKey: string) {
    const ruleSet = await this.prisma.ruleSet.findUnique({
      where: { key: ruleSetKey },
      include: {
        rules: {
          include: {
            chunks: true,
          },
          orderBy: { order: 'asc' },
        },
      },
    })

    return ruleSet
  }
}
