import { Injectable } from '@nestjs/common'
import type { CvSectionType } from 'src/generated/prisma/enums'

export interface DetectedSection {
  type: CvSectionType
  order: number
  content: string
  startLine: number
  endLine: number
}

/**
 * CvSectioningService - Stage 3
 *
 * Purpose: Deterministically split CV text into ordered, typed sections.
 *
 * Allowed logic:
 * - Heuristic-only section detection (headers/keywords/patterns)
 * - Deterministic ordering
 */
@Injectable()
export class CvSectioningService {
  // Section header patterns (order matters for priority)
  private readonly sectionPatterns: Array<{
    type: CvSectionType
    patterns: RegExp[]
  }> = [
    {
      type: 'EDUCATION',
      patterns: [/^education$/i, /^academic\s*(background|qualifications)?$/i, /^học vấn$/i, /^bằng cấp$/i],
    },
    {
      type: 'EXPERIENCE',
      patterns: [
        /^(work\s*)?experience$/i,
        /^employment(\s*history)?$/i,
        /^work\s*history$/i,
        /^professional\s*experience$/i,
        /^kinh nghiệm(\s*làm việc)?$/i,
      ],
    },
    {
      type: 'PROJECTS',
      patterns: [/^projects?$/i, /^personal\s*projects?$/i, /^academic\s*projects?$/i, /^portfolio$/i, /^dự án$/i],
    },
    {
      type: 'SKILLS',
      patterns: [
        /^(technical\s*)?skills?$/i,
        /^competenc(y|ies)$/i,
        /^technologies$/i,
        /^tech\s*stack$/i,
        /^kỹ năng$/i,
        // Combined sections: Skills & Languages / Languages & Skills (treat as SKILLS so rules don't report "lack skill section")
        /^skills?\s*[&\/\u2013-]\s*languages?$/i,
        /^languages?\s*[&\/\u2013-]\s*skills?$/i,
        /^skills?\s+and\s+languages?$/i,
        /^languages?\s+and\s+skills?$/i,
        /^(technical\s*)?skills?\s*[&\/\u2013-]\s*languages?$/i,
        /^languages?\s*[&\/\u2013-]\s*(technical\s*)?skills?$/i,
      ],
    },
    {
      type: 'SUMMARY',
      patterns: [
        /^summary$/i,
        /^(professional\s*)?profile$/i,
        /^objective$/i,
        /^about(\s*me)?$/i,
        /^introduction$/i,
        /^giới thiệu$/i,
        /^mục tiêu$/i,
      ],
    },
    {
      type: 'ACTIVITIES',
      patterns: [
        /^activit(y|ies)$/i,
        /^extracurricular(s)?$/i,
        /^volunteer(ing)?$/i,
        /^leadership$/i,
        /^organizations?$/i,
        /^hoạt động$/i,
        /^tình nguyện$/i,
      ],
    },
  ]

  /**
   * Detect sections from CV text
   * @param text Raw CV text
   * @returns Array of detected sections with their content
   */
  detectSections(text: string): DetectedSection[] {
    const lines = text.split('\n')
    const sections: DetectedSection[] = []
    let currentSection: DetectedSection | null = null
    let order = 0

    // First pass: identify section headers and their positions
    const sectionBoundaries: Array<{
      type: CvSectionType
      lineIndex: number
    }> = []

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      const sectionType = this.detectSectionType(line)

      if (sectionType) {
        sectionBoundaries.push({ type: sectionType, lineIndex: i })
      }
    }

    // If no sections detected, create a single SUMMARY section
    if (sectionBoundaries.length === 0) {
      return [
        {
          type: 'SUMMARY',
          order: 0,
          content: text,
          startLine: 0,
          endLine: lines.length - 1,
        },
      ]
    }

    // Second pass: extract content for each section
    for (let i = 0; i < sectionBoundaries.length; i++) {
      const current = sectionBoundaries[i]
      const next = sectionBoundaries[i + 1]

      const startLine = current.lineIndex + 1 // Skip the header line
      const endLine = next ? next.lineIndex - 1 : lines.length - 1

      const contentLines = lines.slice(startLine, endLine + 1)
      const content = contentLines.join('\n').trim()

      if (content.length > 0) {
        sections.push({
          type: current.type,
          order: order++,
          content,
          startLine,
          endLine,
        })
      }
    }

    // Handle content before first section (treat as SUMMARY if exists)
    if (sectionBoundaries[0].lineIndex > 0) {
      const preambleContent = lines.slice(0, sectionBoundaries[0].lineIndex).join('\n').trim()

      if (preambleContent.length > 20) {
        // Insert at beginning with order -1, then renumber
        sections.unshift({
          type: 'SUMMARY',
          order: -1,
          content: preambleContent,
          startLine: 0,
          endLine: sectionBoundaries[0].lineIndex - 1,
        })

        // Renumber all sections
        sections.forEach((s, i) => {
          s.order = i
        })
      }
    }

    return sections
  }

  /**
   * Detect section type from a line
   * @param line Line to check
   * @returns Section type if it's a header, null otherwise
   */
  private detectSectionType(line: string): CvSectionType | null {
    // Skip lines that are too long (unlikely to be headers)
    if (line.length > 50) return null

    // Skip lines with too many words (unlikely to be headers)
    if (line.split(/\s+/).length > 5) return null

    // Remove common decorations
    const cleanLine = line
      .replace(/^[#*\-•:]+\s*/, '') // Remove leading punctuation
      .replace(/[#*\-•:]+\s*$/, '') // Remove trailing punctuation
      .replace(/^\d+\.\s*/, '') // Remove numbering
      .trim()

    for (const { type, patterns } of this.sectionPatterns) {
      for (const pattern of patterns) {
        if (pattern.test(cleanLine)) {
          return type
        }
      }
    }

    return null
  }
}
