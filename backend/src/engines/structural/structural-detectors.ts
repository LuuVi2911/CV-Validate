import { Injectable } from '@nestjs/common'
import type { CvSectionType } from 'src/generated/prisma/enums'

/**
 * STRUCTURAL DETECTORS
 *
 * Purpose: Run code-based structural checks on CVs.
 * These are NOT semantic - they check for presence/format of specific elements.
 *
 * Allowed:
 * - Email/phone/URL presence checks
 * - Date format detection
 * - Section presence checks
 * - Metric/number pattern detection
 * - Format validation
 *
 * Forbidden:
 * - Semantic meaning inference
 * - Keyword-based skill/outcome detection
 * - Any embedding/similarity logic
 */

// =============================================================================
// TYPES
// =============================================================================

export interface CvForStructuralCheck {
  id: string
  sections: Array<{
    id: string
    type: CvSectionType
    order: number
    chunks: Array<{
      id: string
      content: string
      order: number
    }>
  }>
}

export interface StructuralCheckResult {
  checkKey: string
  passed: boolean
  reason: string
  evidence: {
    sectionType?: string
    chunkId?: string
    matchedPattern?: string
    snippet?: string
  } | null
}

// =============================================================================
// PATTERNS
// =============================================================================

const PATTERNS = {
  // Email: standard email format
  EMAIL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,

  // Phone: various phone formats
  PHONE: /(?:\+?[0-9]{1,3}[-.\s]?)?(?:\([0-9]{1,4}\)|[0-9]{1,4})[-.\s]?[0-9]{1,4}[-.\s]?[0-9]{1,9}/,

  // LinkedIn URL
  LINKEDIN: /linkedin\.com\/in\/[a-zA-Z0-9-]+/i,

  // GitHub URL
  GITHUB: /github\.com\/[a-zA-Z0-9-]+/i,

  // Generic URL
  URL: /https?:\/\/[^\s<>\"]+/i,

  // Date patterns (various formats)
  DATE: /(?:\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})|(?:\d{4}[\/\-\.]\d{1,2})|(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})|(?:\d{4}\s*[-–]\s*(?:\d{4}|Present|Current|Now))/i,

  // Metric patterns (numbers with context)
  METRIC: /\d+(?:\.\d+)?(?:\s*[%xX×]|\s*(?:users?|customers?|clients?|downloads?|visitors?|members?|employees?|projects?|features?|hours?|days?|weeks?|months?|years?))/i,

  // Currency
  CURRENCY: /(?:\$|€|£|¥|₹)\s*\d+(?:,\d{3})*(?:\.\d{2})?(?:\s*(?:K|M|B|k|m))?/,

  // Percentage
  PERCENTAGE: /\d+(?:\.\d+)?\s*%/,

  // Degree keywords (for education validation)
  DEGREE: /bachelor|master|bs|ba|ms|ma|phd|degree|diploma|certificate|bsc|msc|mba|be|btech|mtech/i,
} as const

// =============================================================================
// SERVICE
// =============================================================================

@Injectable()
export class StructuralDetectors {
  /**
   * Run all available structural checks on a CV
   */
  runAllChecks(cv: CvForStructuralCheck): StructuralCheckResult[] {
    return [
      this.checkEmailPresent(cv),
      this.checkPhonePresent(cv),
      this.checkLinkedInPresent(cv),
      this.checkGitHubPresent(cv),
      this.checkRequiredSections(cv),
      this.checkDatePresence(cv),
      this.checkMetricsPresence(cv),
      this.checkEducationDegree(cv),
    ]
  }

  /**
   * Run a specific check by key
   */
  runCheck(cv: CvForStructuralCheck, checkKey: string): StructuralCheckResult | null {
    switch (checkKey) {
      case 'email_present':
        return this.checkEmailPresent(cv)
      case 'phone_present':
        return this.checkPhonePresent(cv)
      case 'linkedin_present':
        return this.checkLinkedInPresent(cv)
      case 'github_present':
        return this.checkGitHubPresent(cv)
      case 'required_sections':
        return this.checkRequiredSections(cv)
      case 'date_present':
        return this.checkDatePresence(cv)
      case 'metrics_present':
        return this.checkMetricsPresence(cv)
      case 'education_degree':
        return this.checkEducationDegree(cv)
      default:
        return null
    }
  }

  /**
   * Check if email is present
   */
  checkEmailPresent(cv: CvForStructuralCheck): StructuralCheckResult {
    const result = this.findPatternInCv(cv, PATTERNS.EMAIL)

    return {
      checkKey: 'email_present',
      passed: result.found,
      reason: result.found
        ? `Email found: ${result.matchedPattern}`
        : 'No email address found in CV',
      evidence: result.found
        ? {
            sectionType: result.sectionType,
            chunkId: result.chunkId,
            matchedPattern: result.matchedPattern,
            snippet: result.snippet,
          }
        : null,
    }
  }

  /**
   * Check if phone number is present
   */
  checkPhonePresent(cv: CvForStructuralCheck): StructuralCheckResult {
    const result = this.findPatternInCv(cv, PATTERNS.PHONE)

    return {
      checkKey: 'phone_present',
      passed: result.found,
      reason: result.found
        ? `Phone number found: ${result.matchedPattern}`
        : 'No phone number found in CV',
      evidence: result.found
        ? {
            sectionType: result.sectionType,
            chunkId: result.chunkId,
            matchedPattern: result.matchedPattern,
            snippet: result.snippet,
          }
        : null,
    }
  }

  /**
   * Check if LinkedIn URL is present
   */
  checkLinkedInPresent(cv: CvForStructuralCheck): StructuralCheckResult {
    const result = this.findPatternInCv(cv, PATTERNS.LINKEDIN)

    return {
      checkKey: 'linkedin_present',
      passed: result.found,
      reason: result.found
        ? 'LinkedIn profile URL found'
        : 'No LinkedIn profile URL found',
      evidence: result.found
        ? {
            sectionType: result.sectionType,
            chunkId: result.chunkId,
            matchedPattern: result.matchedPattern,
            snippet: result.snippet,
          }
        : null,
    }
  }

  /**
   * Check if GitHub URL is present
   */
  checkGitHubPresent(cv: CvForStructuralCheck): StructuralCheckResult {
    const result = this.findPatternInCv(cv, PATTERNS.GITHUB)

    return {
      checkKey: 'github_present',
      passed: result.found,
      reason: result.found
        ? 'GitHub profile URL found'
        : 'No GitHub profile URL found',
      evidence: result.found
        ? {
            sectionType: result.sectionType,
            chunkId: result.chunkId,
            matchedPattern: result.matchedPattern,
            snippet: result.snippet,
          }
        : null,
    }
  }

  /**
   * Check if required sections are present
   */
  checkRequiredSections(cv: CvForStructuralCheck): StructuralCheckResult {
    const requiredSections: CvSectionType[] = ['EDUCATION', 'SKILLS']
    const experienceOrProjects = ['EXPERIENCE', 'PROJECTS', 'ACTIVITIES'] as CvSectionType[]

    const sectionTypes = cv.sections.map((s) => s.type)

    const missingRequired = requiredSections.filter((s) => !sectionTypes.includes(s))
    const hasExperienceOrProjects = experienceOrProjects.some((s) => sectionTypes.includes(s))

    const missing: string[] = [...missingRequired]
    if (!hasExperienceOrProjects) {
      missing.push('Experience/Projects/Activities')
    }

    const passed = missing.length === 0

    return {
      checkKey: 'required_sections',
      passed,
      reason: passed
        ? 'All required sections found'
        : `Missing required sections: ${missing.join(', ')}`,
      evidence: null,
    }
  }

  /**
   * Check if dates are present in relevant sections
   */
  checkDatePresence(cv: CvForStructuralCheck): StructuralCheckResult {
    // Check in EXPERIENCE, PROJECTS, EDUCATION sections
    const relevantSections = cv.sections.filter((s) =>
      ['EXPERIENCE', 'PROJECTS', 'EDUCATION', 'ACTIVITIES'].includes(s.type),
    )

    let foundCount = 0
    let firstMatch: { sectionType: string; chunkId: string; matchedPattern: string; snippet: string } | null = null

    for (const section of relevantSections) {
      for (const chunk of section.chunks) {
        const match = chunk.content.match(PATTERNS.DATE)
        if (match) {
          foundCount++
          if (!firstMatch) {
            firstMatch = {
              sectionType: section.type,
              chunkId: chunk.id,
              matchedPattern: match[0],
              snippet: chunk.content.slice(0, 100),
            }
          }
        }
      }
    }

    const passed = foundCount >= 1 // At least one date

    return {
      checkKey: 'date_present',
      passed,
      reason: passed
        ? `Dates found (${foundCount} instances)`
        : 'No dates found in Experience/Projects/Education sections',
      evidence: firstMatch,
    }
  }

  /**
   * Check if metrics/quantifiable results are present
   */
  checkMetricsPresence(cv: CvForStructuralCheck): StructuralCheckResult {
    const relevantSections = cv.sections.filter((s) =>
      ['EXPERIENCE', 'PROJECTS', 'ACTIVITIES'].includes(s.type),
    )

    let foundCount = 0
    let firstMatch: { sectionType: string; chunkId: string; matchedPattern: string; snippet: string } | null = null

    for (const section of relevantSections) {
      for (const chunk of section.chunks) {
        const metricMatch = chunk.content.match(PATTERNS.METRIC)
        const percentMatch = chunk.content.match(PATTERNS.PERCENTAGE)
        const currencyMatch = chunk.content.match(PATTERNS.CURRENCY)

        const match = metricMatch || percentMatch || currencyMatch
        if (match) {
          foundCount++
          if (!firstMatch) {
            firstMatch = {
              sectionType: section.type,
              chunkId: chunk.id,
              matchedPattern: match[0],
              snippet: chunk.content.slice(0, 100),
            }
          }
        }
      }
    }

    // Soft check - metrics are nice to have
    const passed = foundCount >= 1

    return {
      checkKey: 'metrics_present',
      passed,
      reason: passed
        ? `Metrics/quantifiable results found (${foundCount} instances)`
        : 'No metrics or quantifiable results found',
      evidence: firstMatch,
    }
  }

  /**
   * Check if education section has degree information
   */
  checkEducationDegree(cv: CvForStructuralCheck): StructuralCheckResult {
    const educationSection = cv.sections.find((s) => s.type === 'EDUCATION')

    if (!educationSection) {
      return {
        checkKey: 'education_degree',
        passed: false,
        reason: 'No Education section found',
        evidence: null,
      }
    }

    const content = educationSection.chunks.map((c) => c.content).join(' ')
    const match = content.match(PATTERNS.DEGREE)

    return {
      checkKey: 'education_degree',
      passed: !!match,
      reason: match
        ? `Degree information found: ${match[0]}`
        : 'No degree/qualification keywords found in Education section',
      evidence: match
        ? {
            sectionType: 'EDUCATION',
            matchedPattern: match[0],
            snippet: content.slice(0, 100),
          }
        : null,
    }
  }

  /**
   * Helper: Find a pattern anywhere in CV
   */
  private findPatternInCv(cv: CvForStructuralCheck, pattern: RegExp): {
    found: boolean
    sectionType?: string
    chunkId?: string
    matchedPattern?: string
    snippet?: string
  } {
    for (const section of cv.sections) {
      for (const chunk of section.chunks) {
        const match = chunk.content.match(pattern)
        if (match) {
          return {
            found: true,
            sectionType: section.type,
            chunkId: chunk.id,
            matchedPattern: match[0],
            snippet: chunk.content.slice(0, 100),
          }
        }
      }
    }

    return { found: false }
  }
}
