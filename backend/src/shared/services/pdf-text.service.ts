import { Injectable } from '@nestjs/common'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PDFParse } = require('pdf-parse')

/**
 * PdfTextService - Stage 2
 *
 * Purpose: Convert PDF bytes into raw text deterministically.
 *
 * Allowed logic:
 * - Deterministic PDF → text extraction
 * - Normalization (whitespace collapse) as deterministic preprocessing
 *
 * Forbidden logic:
 * - Any rule evaluation
 * - Any inference / AI
 */
@Injectable()
export class PdfTextService {
  /**
   * Extract text from PDF buffer
   * @param buffer PDF file buffer
   * @returns Extracted text content
   * @throws Error if PDF is unreadable or empty
   */
  async extractText(buffer: Buffer): Promise<string> {
    try {
      const parser = new PDFParse({ data: buffer })
      const data = await parser.getText()
      const rawText = data.text

      if (!rawText || rawText.trim().length === 0) {
        throw new Error('PDF_EMPTY_TEXT')
      }

      // Normalize text deterministically
      const normalizedText = this.normalizeText(rawText)

      if (normalizedText.length < 50) {
        throw new Error('PDF_EMPTY_TEXT')
      }

      return normalizedText
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'PDF_EMPTY_TEXT') {
          throw error
        }
        // Log the actual error for debugging
        console.error('[PdfTextService] PDF parse error:', error.message)
      }
      throw new Error('PDF_UNREADABLE')
    }
  }

  /**
   * Normalize text deterministically
   * - Replace multiple whitespace with single space
   * - Trim lines
   * - Remove excessive blank lines
   */
  private normalizeText(text: string): string {
    return text
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter((line) => line.length > 0)
      .join('\n')
  }
}
