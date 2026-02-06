import { Injectable } from '@nestjs/common'
import type { DetectedSection } from './cv-sectioning.service'

export interface CvChunkData {
  sectionOrder: number
  sectionType: string
  order: number
  content: string
}

/**
 * CvChunkingService - Stage 4
 *
 * Purpose: Convert each section into bullet-level chunks (1 bullet = 1 chunk)
 * with stable ordering.
 *
 * Allowed logic:
 * - Deterministic bullet splitting (-, •, numbered lists, newline heuristics)
 * - Stable order assignment per section
 * - Content normalization (trim, collapse multiple spaces)
 */
@Injectable()
export class CvChunkingService {
  // Bullet point patterns
  private readonly bulletPatterns = [
    /^[-•●○◦▪▸►]\s+/, // Common bullet characters
    /^\*\s+/, // Asterisk bullet
    /^\d+\.\s+/, // Numbered list (1. 2. 3.)
    /^\([a-z]\)\s+/i, // Lettered list (a) (b) (c)
    /^[a-z]\)\s+/i, // Lettered list a) b) c)
  ]

  /**
   * Create chunks from detected sections
   * @param sections Detected sections with their content
   * @returns Array of chunks ready to be persisted
   */
  createChunks(sections: DetectedSection[]): CvChunkData[] {
    const allChunks: CvChunkData[] = []

    for (const section of sections) {
      const sectionChunks = this.chunkSection(section)
      allChunks.push(...sectionChunks)
    }

    return allChunks
  }

  /**
   * Chunk a single section into bullet-level pieces
   */
  private chunkSection(section: DetectedSection): CvChunkData[] {
    const lines = section.content.split('\n')
    const chunks: CvChunkData[] = []
    let currentChunk: string[] = []
    let chunkOrder = 0

    for (const line of lines) {
      const trimmedLine = line.trim()

      if (!trimmedLine) {
        // Empty line might indicate end of a chunk
        if (currentChunk.length > 0) {
          const content = this.normalizeChunkContent(currentChunk.join(' '))
          if (content.length >= 10) {
            chunks.push({
              sectionOrder: section.order,
              sectionType: section.type,
              order: chunkOrder++,
              content,
            })
          }
          currentChunk = []
        }
        continue
      }

      const isBulletStart = this.isBulletLine(trimmedLine)

      if (isBulletStart) {
        // Save previous chunk if exists
        if (currentChunk.length > 0) {
          const content = this.normalizeChunkContent(currentChunk.join(' '))
          if (content.length >= 10) {
            chunks.push({
              sectionOrder: section.order,
              sectionType: section.type,
              order: chunkOrder++,
              content,
            })
          }
        }
        // Start new chunk with bullet content (without bullet marker)
        currentChunk = [this.removeBulletMarker(trimmedLine)]
      } else {
        // Continuation of current chunk
        currentChunk.push(trimmedLine)
      }
    }

    // Don't forget the last chunk
    if (currentChunk.length > 0) {
      const content = this.normalizeChunkContent(currentChunk.join(' '))
      if (content.length >= 10) {
        chunks.push({
          sectionOrder: section.order,
          sectionType: section.type,
          order: chunkOrder++,
          content,
        })
      }
    }

    // If no bullets found, create chunks based on sentences or paragraphs
    if (chunks.length === 0 && section.content.length > 0) {
      return this.fallbackChunking(section)
    }

    return chunks
  }

  /**
   * Fallback chunking when no bullet patterns are detected
   * Split by sentences or paragraphs
   */
  private fallbackChunking(section: DetectedSection): CvChunkData[] {
    const chunks: CvChunkData[] = []

    // Try splitting by double newlines (paragraphs) first
    const paragraphs = section.content.split(/\n\s*\n/)

    if (paragraphs.length > 1) {
      paragraphs.forEach((para, order) => {
        const content = this.normalizeChunkContent(para)
        if (content.length >= 10) {
          chunks.push({
            sectionOrder: section.order,
            sectionType: section.type,
            order,
            content,
          })
        }
      })
    } else {
      // Split by sentences for long single paragraphs
      const sentences = this.splitIntoSentences(section.content)
      sentences.forEach((sentence, order) => {
        const content = this.normalizeChunkContent(sentence)
        if (content.length >= 10) {
          chunks.push({
            sectionOrder: section.order,
            sectionType: section.type,
            order,
            content,
          })
        }
      })
    }

    // If still no chunks, create one chunk with the whole content
    if (chunks.length === 0) {
      const content = this.normalizeChunkContent(section.content)
      if (content.length >= 10) {
        chunks.push({
          sectionOrder: section.order,
          sectionType: section.type,
          order: 0,
          content,
        })
      }
    }

    return chunks
  }

  /**
   * Split text into sentences
   */
  private splitIntoSentences(text: string): string[] {
    // Simple sentence splitting - handles common cases
    return text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0)
  }

  /**
   * Check if a line starts with a bullet marker
   */
  private isBulletLine(line: string): boolean {
    return this.bulletPatterns.some((pattern) => pattern.test(line))
  }

  /**
   * Remove bullet marker from the beginning of a line
   */
  private removeBulletMarker(line: string): string {
    for (const pattern of this.bulletPatterns) {
      if (pattern.test(line)) {
        return line.replace(pattern, '')
      }
    }
    return line
  }

  /**
   * Normalize chunk content
   * - Trim whitespace
   * - Collapse multiple spaces
   * - Remove excessive punctuation
   */
  private normalizeChunkContent(content: string): string {
    return content
      .replace(/\s+/g, ' ')
      .replace(/\s*([,;:])\s*/g, '$1 ')
      .trim()
  }
}
