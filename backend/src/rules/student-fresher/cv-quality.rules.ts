/**
 * CV QUALITY RULE SET - STRUCTURAL RULES ONLY
 * ROLE: STUDENT / FRESHER (INTERNSHIP & ENTRY-LEVEL READY)
 * EVALUATION: JD-INDEPENDENT, ATS-COMPLIANT
 *
 * Based on: Rule For Student.pdf
 *
 * =============================================================================
 * HYBRID RULE MODEL
 * =============================================================================
 *
 * This file contains ONLY STRUCTURAL rules that check FORMAT and PATTERNS:
 * - Section existence
 * - Email/phone/URL patterns
 * - Date patterns
 * - Metric patterns (numbers, percentages)
 *
 * SEMANTIC RULES are evaluated via EMBEDDINGS using:
 * - RuleIngestionService: Ingest rules from PDF → RuleSet/Rule/RuleChunk
 * - SemanticEvaluator: pgvector similarity search against CV chunks
 *
 * STRUCTURAL RULES IN THIS FILE:
 * - S-MH-01: Required Sections (section existence)
 * - S-MH-03: Contact Information (email/phone regex)
 * - S-MH-04: Professional Online Presence (LinkedIn/GitHub URL)
 * - S-MH-05: Education Integrity (date + degree patterns)
 * - S-MH-06: Date Presence Requirement (date patterns)
 * - S-MH-08: Evidence of Practical Work (section existence)
 * - S-MH-11: Project Verifiability (URL patterns)
 * - S-NH-01: Project Timeframe Disclosure (date patterns)
 * - S-NH-07: Clear Activities Section (section existence)
 * - S-BP-01: Experience Presence (section existence)
 * - S-BP-03: Measurable Impact (metric patterns)
 *
 * SEMANTIC RULES (evaluated via embeddings, NOT in this file):
 * - S-MH-07: Skills Section with Hard Skills
 * - S-MH-09: Bullet-Based Descriptions (action verbs)
 * - S-MH-10: Personal Contribution Clarity
 * - S-NH-02: Team Context Disclosure
 * - S-NH-03: Outcome Description
 * - S-NH-04: Achievements and Competitions
 * - S-NH-05: Learning Beyond Coursework
 * - S-NH-06: Commitment Over Time
 * - S-NH-08: Meaningful Contribution in Activities
 * - S-BP-02: Experience Content Quality
 * - S-BP-04: Role Ownership or Initiative
 *
 * =============================================================================
 */

import type { CvQualityFindingDTO } from 'src/routes/evaluation/evaluation.dto'
import type { RuleCategoryType, EvidenceType } from 'src/routes/evaluation/evaluation.model'

export const CV_QUALITY_RULE_SET_VERSION = 'student-fresher.cv-quality@2026-02-03'

type CvData = {
  id: string
  sections: Array<{
    id: string
    type: string
    order: number
    chunks: Array<{
      id: string
      order: number
      content: string
    }>
  }>
}

interface CvQualityRule {
  ruleId: string
  category: RuleCategoryType
  severity: 'critical' | 'warning' | 'info'
  description: string
  /** STRUCTURAL or SEMANTIC - only STRUCTURAL rules have evaluate function */
  strategy: 'STRUCTURAL' | 'SEMANTIC'
  evaluate?: (cv: CvData) => CvQualityFindingDTO
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function createSectionEvidence(cvId: string, sectionType: string, sectionId?: string): EvidenceType {
  return { type: 'section', cvId, sectionType, sectionId }
}

function createChunkEvidence(
  cvId: string,
  sectionType: string,
  sectionId: string,
  chunkId: string,
  chunkOrder: number,
  snippet: string,
): EvidenceType {
  return { type: 'chunk', cvId, sectionType, sectionId, chunkId, chunkOrder, snippet }
}

function getAllContent(cv: CvData): string {
  return cv.sections.flatMap((s) => s.chunks.map((c) => c.content)).join(' ')
}

// =============================================================================
// II. STRUCTURAL RULES - MUST_HAVE (FORMAT/PATTERN CHECKS)
// =============================================================================

/**
 * Rule S-MH-01: Required Sections
 * STRUCTURAL: Checks section existence
 */
const requiredSections: CvQualityRule = {
  ruleId: 'S-MH-01',
  category: 'MUST_HAVE',
  severity: 'critical',
  strategy: 'STRUCTURAL',
  description: 'CV must contain required sections: Contact Info, Education, Skills, and Experience/Projects/Activities',
  evaluate: (cv) => {
    const hasEducation = cv.sections.some((s) => s.type === 'EDUCATION')
    const hasSkills = cv.sections.some((s) => s.type === 'SKILLS')
    const hasExperienceOrProjects = cv.sections.some((s) => ['EXPERIENCE', 'PROJECTS', 'ACTIVITIES'].includes(s.type))

    const missing: string[] = []
    if (!hasEducation) missing.push('Education')
    if (!hasSkills) missing.push('Skills')
    if (!hasExperienceOrProjects) missing.push('Experience/Projects/Activities')

    const passed = missing.length === 0

    return {
      ruleId: 'S-MH-01',
      category: 'MUST_HAVE',
      passed,
      severity: 'critical',
      reason: passed ? 'All required sections found' : `Missing required sections: ${missing.join(', ')}`,
      evidence: [createSectionEvidence(cv.id, missing[0] || 'SUMMARY')],
    }
  },
}

/**
 * Rule S-MH-03: Contact Information Completeness
 * STRUCTURAL: Checks email/phone patterns via regex
 */
const contactInfoCompleteness: CvQualityRule = {
  ruleId: 'S-MH-03',
  category: 'MUST_HAVE',
  severity: 'critical',
  strategy: 'STRUCTURAL',
  description: 'Contact Information must include full name and professional email',
  evaluate: (cv) => {
    const allContent = getAllContent(cv)
    const emailRegex = /[\w.-]+@[\w.-]+\.\w+/
    const phoneRegex = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/

    const hasEmail = emailRegex.test(allContent)
    const hasPhone = phoneRegex.test(allContent)

    const summarySection = cv.sections.find((s) => s.type === 'SUMMARY')
    const passed = hasEmail

    return {
      ruleId: 'S-MH-03',
      category: 'MUST_HAVE',
      passed,
      severity: 'critical',
      reason: passed
        ? `Contact information found${!hasPhone ? ' (consider adding phone number)' : ''}`
        : 'Missing professional email address - recruiters need to reach you',
      evidence: [createSectionEvidence(cv.id, 'SUMMARY', summarySection?.id)],
    }
  },
}

/**
 * Rule S-MH-04: Professional Online Presence
 * STRUCTURAL: Checks for LinkedIn/GitHub URL patterns
 */
const professionalOnlinePresence: CvQualityRule = {
  ruleId: 'S-MH-04',
  category: 'MUST_HAVE',
  severity: 'critical',
  strategy: 'STRUCTURAL',
  description: 'CV must include at least one professional profile (LinkedIn or GitHub)',
  evaluate: (cv) => {
    const allContent = getAllContent(cv).toLowerCase()
    const hasLinkedIn = /linkedin\.com|linkedin/i.test(allContent)
    const hasGitHub = /github\.com|github/i.test(allContent)

    const passed = hasLinkedIn || hasGitHub

    return {
      ruleId: 'S-MH-04',
      category: 'MUST_HAVE',
      passed,
      severity: 'critical',
      reason: passed
        ? `Professional profile found: ${hasLinkedIn ? 'LinkedIn' : ''}${hasLinkedIn && hasGitHub ? ', ' : ''}${hasGitHub ? 'GitHub' : ''}`
        : 'Missing professional profile - add LinkedIn or GitHub link',
      evidence: [createSectionEvidence(cv.id, 'SUMMARY')],
    }
  },
}

/**
 * Rule S-MH-05: Education Integrity
 * STRUCTURAL: Checks for date patterns and degree format keywords
 */
const educationIntegrity: CvQualityRule = {
  ruleId: 'S-MH-05',
  category: 'MUST_HAVE',
  severity: 'critical',
  strategy: 'STRUCTURAL',
  description: 'Education entries must include institution, degree, field of study, and study period',
  evaluate: (cv) => {
    const educationSection = cv.sections.find((s) => s.type === 'EDUCATION')
    if (!educationSection) {
      return {
        ruleId: 'S-MH-05',
        category: 'MUST_HAVE',
        passed: false,
        severity: 'critical',
        reason: 'No Education section found',
        evidence: [createSectionEvidence(cv.id, 'EDUCATION')],
      }
    }

    const content = educationSection.chunks.map((c) => c.content).join(' ')
    const hasDatePattern = /20\d{2}|19\d{2}|present|current|expected/i.test(content)
    const hasDegreeKeyword = /bachelor|master|bs|ba|ms|ma|phd|degree|diploma|certificate|bsc|msc/i.test(content)

    const passed = hasDatePattern && hasDegreeKeyword

    return {
      ruleId: 'S-MH-05',
      category: 'MUST_HAVE',
      passed,
      severity: 'critical',
      reason: passed
        ? 'Education section contains required information'
        : `Education section incomplete: ${!hasDatePattern ? 'missing dates' : ''}${!hasDatePattern && !hasDegreeKeyword ? ', ' : ''}${!hasDegreeKeyword ? 'missing degree information' : ''}`,
      evidence: [createSectionEvidence(cv.id, 'EDUCATION', educationSection.id)],
    }
  },
}

/**
 * Rule S-MH-06: Date Presence Requirement
 * STRUCTURAL: Checks for date/time patterns
 */
const datePresenceRequirement: CvQualityRule = {
  ruleId: 'S-MH-06',
  category: 'MUST_HAVE',
  severity: 'critical',
  strategy: 'STRUCTURAL',
  description: 'Entries must include clear time periods or durations',
  evaluate: (cv) => {
    const relevantSections = cv.sections.filter((s) =>
      ['EDUCATION', 'EXPERIENCE', 'PROJECTS', 'ACTIVITIES'].includes(s.type),
    )

    const datePattern = /20\d{2}|19\d{2}|present|current|ongoing|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i
    let sectionsWithDates = 0

    for (const section of relevantSections) {
      const content = section.chunks.map((c) => c.content).join(' ')
      if (datePattern.test(content)) {
        sectionsWithDates++
      }
    }

    const passed = relevantSections.length === 0 || sectionsWithDates >= relevantSections.length * 0.5

    return {
      ruleId: 'S-MH-06',
      category: 'MUST_HAVE',
      passed,
      severity: 'critical',
      reason: passed
        ? 'Time periods found in entries'
        : 'Multiple entries missing time information - add dates to your experiences and projects',
      evidence: [createSectionEvidence(cv.id, 'EXPERIENCE')],
    }
  },
}

/**
 * Rule S-MH-07: Skills Section with Hard Skills
 * SEMANTIC: Evaluated via embeddings - checks if skills section has technical content
 * Note: Only checks section existence here; content quality via SemanticEvaluator
 */
const skillsSectionRequirement: CvQualityRule = {
  ruleId: 'S-MH-07',
  category: 'MUST_HAVE',
  severity: 'critical',
  strategy: 'SEMANTIC',
  description: 'CV must include a Skills section with hard skills (tools, technologies)',
  // No evaluate function - evaluated via SemanticEvaluator with embedded rules
}

/**
 * Rule S-MH-08: Evidence of Practical Work
 * STRUCTURAL: Checks section existence
 */
const practicalWorkEvidence: CvQualityRule = {
  ruleId: 'S-MH-08',
  category: 'MUST_HAVE',
  severity: 'critical',
  strategy: 'STRUCTURAL',
  description: 'CV must show evidence of practical work (projects, volunteer roles, or internships)',
  evaluate: (cv) => {
    const hasExperience = cv.sections.some((s) => s.type === 'EXPERIENCE' && s.chunks.length > 0)
    const hasProjects = cv.sections.some((s) => s.type === 'PROJECTS' && s.chunks.length > 0)
    const hasActivities = cv.sections.some((s) => s.type === 'ACTIVITIES' && s.chunks.length > 0)

    const passed = hasExperience || hasProjects || hasActivities
    const evidence: string[] = []
    if (hasExperience) evidence.push('Experience')
    if (hasProjects) evidence.push('Projects')
    if (hasActivities) evidence.push('Activities')

    return {
      ruleId: 'S-MH-08',
      category: 'MUST_HAVE',
      passed,
      severity: 'critical',
      reason: passed
        ? `Practical work evidence found: ${evidence.join(', ')}`
        : 'No practical work shown - add projects, volunteer roles, or internship experience',
      evidence: [createSectionEvidence(cv.id, 'PROJECTS')],
    }
  },
}

/**
 * Rule S-MH-09: Bullet-Based Descriptions with Action Verbs
 * SEMANTIC: Evaluated via embeddings - checks for action-oriented language
 */
const bulletBasedDescriptions: CvQualityRule = {
  ruleId: 'S-MH-09',
  category: 'MUST_HAVE',
  severity: 'critical',
  strategy: 'SEMANTIC',
  description:
    'Experience, project, and activity entries must use bullet points with action verbs. Education bullets (coursework, modules) do not require verbs.',
  // No evaluate function - evaluated via SemanticEvaluator with embedded rules
}

/**
 * Rule S-MH-10: Personal Contribution Clarity
 * SEMANTIC: Evaluated via embeddings - checks for personal ownership language
 */
const personalContributionClarity: CvQualityRule = {
  ruleId: 'S-MH-10',
  category: 'MUST_HAVE',
  severity: 'critical',
  strategy: 'SEMANTIC',
  description: 'Entries must clearly describe personal contributions, not just team participation',
  // No evaluate function - evaluated via SemanticEvaluator with embedded rules
}

/**
 * Rule S-MH-11: Project Verifiability
 * STRUCTURAL: Checks for URL patterns
 */
const projectVerifiability: CvQualityRule = {
  ruleId: 'S-MH-11',
  category: 'MUST_HAVE',
  severity: 'critical',
  strategy: 'STRUCTURAL',
  description: 'At least one project must include a verification link (repo, demo, or portfolio)',
  evaluate: (cv) => {
    const projectsSection = cv.sections.find((s) => s.type === 'PROJECTS')
    if (!projectsSection) {
      const hasExperience = cv.sections.some((s) => s.type === 'EXPERIENCE' && s.chunks.length > 0)
      return {
        ruleId: 'S-MH-11',
        category: 'MUST_HAVE',
        passed: hasExperience,
        severity: 'critical',
        reason: hasExperience ? 'No projects section, but has experience' : 'No projects section found',
        evidence: [createSectionEvidence(cv.id, 'PROJECTS')],
      }
    }

    const content = projectsSection.chunks
      .map((c) => c.content)
      .join(' ')
      .toLowerCase()
    const hasLink =
      /github\.com|gitlab\.com|bitbucket\.org|herokuapp\.com|vercel\.app|netlify\.app|\.io\/|http|www\.|portfolio/i.test(
        content,
      )

    return {
      ruleId: 'S-MH-11',
      category: 'MUST_HAVE',
      passed: hasLink,
      severity: 'critical',
      reason: hasLink
        ? 'Project includes verification link'
        : 'No project links found - add GitHub repo, live demo, or portfolio URL',
      evidence: [createSectionEvidence(cv.id, 'PROJECTS', projectsSection.id)],
    }
  },
}

// =============================================================================
// III. STRUCTURAL RULES - NICE_TO_HAVE (FORMAT/PATTERN CHECKS)
// =============================================================================

/**
 * Rule S-NH-01: Project Timeframe Disclosure
 * STRUCTURAL: Checks for date/time patterns
 */
const projectTimeframeDisclosure: CvQualityRule = {
  ruleId: 'S-NH-01',
  category: 'NICE_TO_HAVE',
  severity: 'warning',
  strategy: 'STRUCTURAL',
  description: 'Projects should include a clear time period or duration',
  evaluate: (cv) => {
    const projectsSection = cv.sections.find((s) => s.type === 'PROJECTS')
    if (!projectsSection) {
      return {
        ruleId: 'S-NH-01',
        category: 'NICE_TO_HAVE',
        passed: true,
        severity: 'warning',
        reason: 'No projects section to evaluate',
        evidence: [createSectionEvidence(cv.id, 'PROJECTS')],
      }
    }

    const content = projectsSection.chunks.map((c) => c.content).join(' ')
    const hasTimeframe = /20\d{2}|months?|weeks?|days?|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(content)

    return {
      ruleId: 'S-NH-01',
      category: 'NICE_TO_HAVE',
      passed: hasTimeframe,
      severity: 'warning',
      reason: hasTimeframe ? 'Project timeframes disclosed' : 'Consider adding time periods to your projects',
      evidence: [createSectionEvidence(cv.id, 'PROJECTS', projectsSection.id)],
    }
  },
}

/**
 * Rule S-NH-02: Team Context Disclosure
 * SEMANTIC: Evaluated via embeddings - checks for team collaboration language
 */
const teamContextDisclosure: CvQualityRule = {
  ruleId: 'S-NH-02',
  category: 'NICE_TO_HAVE',
  severity: 'warning',
  strategy: 'SEMANTIC',
  description: 'Projects should indicate whether individual or team-based, and team size',
  // No evaluate function - evaluated via SemanticEvaluator with embedded rules
}

/**
 * Rule S-NH-03: Outcome Description
 * SEMANTIC: Evaluated via embeddings - checks for outcome/result language
 */
const outcomeDescription: CvQualityRule = {
  ruleId: 'S-NH-03',
  category: 'NICE_TO_HAVE',
  severity: 'warning',
  strategy: 'SEMANTIC',
  description: 'Projects should explain what was built, improved, or achieved',
  // No evaluate function - evaluated via SemanticEvaluator with embedded rules
}

/**
 * Rule S-NH-04: Achievements and Competitions
 * SEMANTIC: Evaluated via embeddings - checks for achievement content
 */
const achievementsAndCompetitions: CvQualityRule = {
  ruleId: 'S-NH-04',
  category: 'NICE_TO_HAVE',
  severity: 'warning',
  strategy: 'SEMANTIC',
  description: 'CV may include achievements such as competitions, awards, or academic challenges',
  // No evaluate function - evaluated via SemanticEvaluator with embedded rules
}

/**
 * Rule S-NH-05: Learning Beyond Coursework
 * SEMANTIC: Evaluated via embeddings - checks for self-learning content
 */
const learningBeyondCoursework: CvQualityRule = {
  ruleId: 'S-NH-05',
  category: 'NICE_TO_HAVE',
  severity: 'warning',
  strategy: 'SEMANTIC',
  description: 'CV should show learning outside formal coursework (self-study, side projects, training)',
  // No evaluate function - evaluated via SemanticEvaluator with embedded rules
}

/**
 * Rule S-NH-06: Commitment Over Time
 * SEMANTIC: Evaluated via embeddings - checks for sustained involvement language
 */
const commitmentOverTime: CvQualityRule = {
  ruleId: 'S-NH-06',
  category: 'NICE_TO_HAVE',
  severity: 'warning',
  strategy: 'SEMANTIC',
  description: 'Activities showing sustained involvement over time are stronger than one-time participation',
  // No evaluate function - evaluated via SemanticEvaluator with embedded rules
}

/**
 * Rule S-NH-07: Clear Activities Section
 * STRUCTURAL: Checks section existence
 */
const clearActivitiesSection: CvQualityRule = {
  ruleId: 'S-NH-07',
  category: 'NICE_TO_HAVE',
  severity: 'warning',
  strategy: 'STRUCTURAL',
  description: 'Volunteer or extracurricular activities should be grouped under a clear section',
  evaluate: (cv) => {
    const activitiesSection = cv.sections.find((s) => s.type === 'ACTIVITIES')
    const hasActivities = !!activitiesSection && activitiesSection.chunks.length > 0

    return {
      ruleId: 'S-NH-07',
      category: 'NICE_TO_HAVE',
      passed: hasActivities,
      severity: 'warning',
      reason: hasActivities
        ? 'Activities section present'
        : 'Consider adding an Activities section for volunteer or extracurricular work',
      evidence: [createSectionEvidence(cv.id, 'ACTIVITIES', activitiesSection?.id)],
    }
  },
}

/**
 * Rule S-NH-08: Meaningful Contribution in Activities
 * SEMANTIC: Evaluated via embeddings - checks for meaningful contribution language
 */
const meaningfulContributionInActivities: CvQualityRule = {
  ruleId: 'S-NH-08',
  category: 'NICE_TO_HAVE',
  severity: 'warning',
  strategy: 'SEMANTIC',
  description: 'Activity entries should describe role, actions taken, and value delivered',
  // No evaluate function - evaluated via SemanticEvaluator with embedded rules
}

// =============================================================================
// IV. STRUCTURAL RULES - BEST_PRACTICE (FORMAT/PATTERN CHECKS)
// =============================================================================

/**
 * Rule S-BP-01: Experience Presence
 * STRUCTURAL: Checks section existence
 */
const experiencePresence: CvQualityRule = {
  ruleId: 'S-BP-01',
  category: 'BEST_PRACTICE',
  severity: 'info',
  strategy: 'STRUCTURAL',
  description: 'Having internship or entry-level work experience is a strong positive signal',
  evaluate: (cv) => {
    const experienceSection = cv.sections.find((s) => s.type === 'EXPERIENCE')
    const hasExperience = !!experienceSection && experienceSection.chunks.length > 0

    return {
      ruleId: 'S-BP-01',
      category: 'BEST_PRACTICE',
      passed: hasExperience,
      severity: 'info',
      reason: hasExperience ? 'Has work experience - strong signal' : 'Work experience would strengthen your CV',
      evidence: [createSectionEvidence(cv.id, 'EXPERIENCE', experienceSection?.id)],
    }
  },
}

/**
 * Rule S-BP-02: Experience Content Quality
 * SEMANTIC: Evaluated via embeddings - checks for quality content
 */
const experienceContentQuality: CvQualityRule = {
  ruleId: 'S-BP-02',
  category: 'BEST_PRACTICE',
  severity: 'info',
  strategy: 'SEMANTIC',
  description: 'Experience should describe concrete actions, clear responsibilities, and outcomes',
  // No evaluate function - evaluated via SemanticEvaluator with embedded rules
}

/**
 * Rule S-BP-03: Measurable or Observable Impact
 * STRUCTURAL: Checks for metric patterns (numbers, percentages)
 */
const measurableImpact: CvQualityRule = {
  ruleId: 'S-BP-03',
  category: 'BEST_PRACTICE',
  severity: 'info',
  strategy: 'STRUCTURAL',
  description: 'Strong CVs include work with measurable results or clearly observable outputs',
  evaluate: (cv) => {
    const allContent = getAllContent(cv)
    const measurableIndicators = /\d+%|\d+x|\$\d+|\d+ (users|customers|members|features|downloads|transactions)/i
    const hasMeasurableResults = measurableIndicators.test(allContent)

    const evidence: EvidenceType[] = []
    for (const section of cv.sections) {
      for (const chunk of section.chunks) {
        if (measurableIndicators.test(chunk.content)) {
          evidence.push(
            createChunkEvidence(
              cv.id,
              section.type,
              section.id,
              chunk.id,
              chunk.order,
              chunk.content.substring(0, 100),
            ),
          )
          if (evidence.length >= 2) break
        }
      }
      if (evidence.length >= 2) break
    }

    return {
      ruleId: 'S-BP-03',
      category: 'BEST_PRACTICE',
      passed: hasMeasurableResults,
      severity: 'info',
      reason: hasMeasurableResults
        ? `Found ${evidence.length} quantifiable result(s)`
        : 'Consider adding measurable results (e.g., "improved performance by 30%")',
      evidence: evidence.length > 0 ? evidence : [createSectionEvidence(cv.id, 'EXPERIENCE')],
    }
  },
}

/**
 * Rule S-BP-04: Role Ownership or Initiative
 * SEMANTIC: Evaluated via embeddings - checks for ownership language
 */
const roleOwnershipOrInitiative: CvQualityRule = {
  ruleId: 'S-BP-04',
  category: 'BEST_PRACTICE',
  severity: 'info',
  strategy: 'SEMANTIC',
  description: 'Clear ownership, initiative, or leadership in at least one entry strengthens the CV',
  // No evaluate function - evaluated via SemanticEvaluator with embedded rules
}

// =============================================================================
// EXPORT ALL RULES
// =============================================================================

/**
 * ALL CV quality rules (both STRUCTURAL and SEMANTIC)
 * Use CV_STRUCTURAL_RULES for code-based evaluation
 * SEMANTIC rules are evaluated via SemanticEvaluator with embedded rules from PDF
 */
export const CV_QUALITY_RULES: CvQualityRule[] = [
  // MUST_HAVE
  requiredSections, // S-MH-01 (STRUCTURAL)
  contactInfoCompleteness, // S-MH-03 (STRUCTURAL)
  professionalOnlinePresence, // S-MH-04 (STRUCTURAL)
  educationIntegrity, // S-MH-05 (STRUCTURAL)
  datePresenceRequirement, // S-MH-06 (STRUCTURAL)
  skillsSectionRequirement, // S-MH-07 (SEMANTIC)
  practicalWorkEvidence, // S-MH-08 (STRUCTURAL)
  bulletBasedDescriptions, // S-MH-09 (SEMANTIC)
  personalContributionClarity, // S-MH-10 (SEMANTIC)
  projectVerifiability, // S-MH-11 (STRUCTURAL)

  // NICE_TO_HAVE
  projectTimeframeDisclosure, // S-NH-01 (STRUCTURAL)
  teamContextDisclosure, // S-NH-02 (SEMANTIC)
  outcomeDescription, // S-NH-03 (SEMANTIC)
  achievementsAndCompetitions, // S-NH-04 (SEMANTIC)
  learningBeyondCoursework, // S-NH-05 (SEMANTIC)
  commitmentOverTime, // S-NH-06 (SEMANTIC)
  clearActivitiesSection, // S-NH-07 (STRUCTURAL)
  meaningfulContributionInActivities, // S-NH-08 (SEMANTIC)

  // BEST_PRACTICE
  experiencePresence, // S-BP-01 (STRUCTURAL)
  experienceContentQuality, // S-BP-02 (SEMANTIC)
  measurableImpact, // S-BP-03 (STRUCTURAL)
  roleOwnershipOrInitiative, // S-BP-04 (SEMANTIC)
]

/**
 * STRUCTURAL rules only - these have evaluate() functions
 * Use for code-based format/pattern checks
 */
export const CV_STRUCTURAL_RULES = CV_QUALITY_RULES.filter(
  (rule): rule is CvQualityRule & { evaluate: NonNullable<CvQualityRule['evaluate']> } =>
    rule.strategy === 'STRUCTURAL' && rule.evaluate !== undefined,
)

/**
 * SEMANTIC rules only - these are evaluated via embeddings
 * Used by SemanticEvaluator with rules ingested from PDF
 */
export const CV_SEMANTIC_RULES = CV_QUALITY_RULES.filter((rule) => rule.strategy === 'SEMANTIC')

/**
 * Semantic rule IDs for reference (used by RuleIngestionService)
 */
export const SEMANTIC_RULE_IDS = CV_SEMANTIC_RULES.map((r) => r.ruleId)
