import type { CvQualityFindingDTO } from 'src/routes/evaluation/evaluation.dto'
import type { RuleCategoryType, EvidenceType } from 'src/routes/evaluation/evaluation.model'

export const CV_QUALITY_RULE_SET_VERSION = 'student-fresher.cv-quality@2026-01-29'

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
  evaluate: (cv: CvData) => CvQualityFindingDTO
}

// Helper functions
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

// MUST_HAVE Rules
const hasEducationSection: CvQualityRule = {
  ruleId: 'cv-must-have-education',
  category: 'MUST_HAVE',
  severity: 'critical',
  description: 'CV must have an Education section',
  evaluate: (cv) => {
    const educationSection = cv.sections.find((s) => s.type === 'EDUCATION')
    const passed = !!educationSection
    return {
      ruleId: 'cv-must-have-education',
      category: 'MUST_HAVE',
      passed,
      severity: 'critical',
      reason: passed ? 'Education section found' : 'Missing Education section - required for fresher/intern roles',
      evidence:
        passed && educationSection
          ? [createSectionEvidence(cv.id, 'EDUCATION', educationSection.id)]
          : [createSectionEvidence(cv.id, 'EDUCATION')],
    }
  },
}

const hasContactInfo: CvQualityRule = {
  ruleId: 'cv-must-have-contact',
  category: 'MUST_HAVE',
  severity: 'critical',
  description: 'CV must have contact information (email)',
  evaluate: (cv) => {
    const emailRegex = /[\w.-]+@[\w.-]+\.\w+/
    let found = false
    let foundEvidence: EvidenceType | null = null

    for (const section of cv.sections) {
      for (const chunk of section.chunks) {
        if (emailRegex.test(chunk.content)) {
          found = true
          foundEvidence = createChunkEvidence(
            cv.id,
            section.type,
            section.id,
            chunk.id,
            chunk.order,
            chunk.content.substring(0, 100),
          )
          break
        }
      }
      if (found) break
    }

    return {
      ruleId: 'cv-must-have-contact',
      category: 'MUST_HAVE',
      passed: found,
      severity: 'critical',
      reason: found ? 'Contact email found' : 'Missing contact email - recruiters need to reach you',
      evidence: foundEvidence ? [foundEvidence] : [createSectionEvidence(cv.id, 'SUMMARY')],
    }
  },
}

const hasExperienceOrProjects: CvQualityRule = {
  ruleId: 'cv-must-have-experience-or-projects',
  category: 'MUST_HAVE',
  severity: 'critical',
  description: 'CV must have either Experience or Projects section',
  evaluate: (cv) => {
    const experienceSection = cv.sections.find((s) => s.type === 'EXPERIENCE')
    const projectsSection = cv.sections.find((s) => s.type === 'PROJECTS')
    const passed = !!(experienceSection || projectsSection)

    const evidence: EvidenceType[] = []
    if (experienceSection) {
      evidence.push(createSectionEvidence(cv.id, 'EXPERIENCE', experienceSection.id))
    }
    if (projectsSection) {
      evidence.push(createSectionEvidence(cv.id, 'PROJECTS', projectsSection.id))
    }
    if (!passed) {
      evidence.push(createSectionEvidence(cv.id, 'EXPERIENCE'))
    }

    return {
      ruleId: 'cv-must-have-experience-or-projects',
      category: 'MUST_HAVE',
      passed,
      severity: 'critical',
      reason: passed
        ? 'Experience or Projects section found'
        : 'Missing both Experience and Projects sections - you need to demonstrate your work',
      evidence,
    }
  },
}

// NICE_TO_HAVE Rules
const hasSkillsSection: CvQualityRule = {
  ruleId: 'cv-nice-skills-section',
  category: 'NICE_TO_HAVE',
  severity: 'warning',
  description: 'CV should have a Skills section',
  evaluate: (cv) => {
    const skillsSection = cv.sections.find((s) => s.type === 'SKILLS')
    const passed = !!skillsSection
    return {
      ruleId: 'cv-nice-skills-section',
      category: 'NICE_TO_HAVE',
      passed,
      severity: 'warning',
      reason: passed
        ? 'Skills section found'
        : 'Consider adding a Skills section to highlight your technical abilities',
      evidence:
        passed && skillsSection
          ? [createSectionEvidence(cv.id, 'SKILLS', skillsSection.id)]
          : [createSectionEvidence(cv.id, 'SKILLS')],
    }
  },
}

const hasSummarySection: CvQualityRule = {
  ruleId: 'cv-nice-summary-section',
  category: 'NICE_TO_HAVE',
  severity: 'warning',
  description: 'CV should have a Summary or Objective section',
  evaluate: (cv) => {
    const summarySection = cv.sections.find((s) => s.type === 'SUMMARY')
    const passed = !!summarySection
    return {
      ruleId: 'cv-nice-summary-section',
      category: 'NICE_TO_HAVE',
      passed,
      severity: 'warning',
      reason: passed ? 'Summary section found' : 'Consider adding a Summary section to introduce yourself',
      evidence:
        passed && summarySection
          ? [createSectionEvidence(cv.id, 'SUMMARY', summarySection.id)]
          : [createSectionEvidence(cv.id, 'SUMMARY')],
    }
  },
}

const hasQuantifiableAchievements: CvQualityRule = {
  ruleId: 'cv-nice-quantifiable',
  category: 'NICE_TO_HAVE',
  severity: 'warning',
  description: 'CV should contain quantifiable achievements (numbers, percentages)',
  evaluate: (cv) => {
    const numberRegex = /\d+%|\d+\+|\$\d+|\d+ (users|customers|projects|members|features)/i
    let found = false
    const foundEvidence: EvidenceType[] = []

    for (const section of cv.sections) {
      for (const chunk of section.chunks) {
        if (numberRegex.test(chunk.content)) {
          found = true
          foundEvidence.push(
            createChunkEvidence(
              cv.id,
              section.type,
              section.id,
              chunk.id,
              chunk.order,
              chunk.content.substring(0, 100),
            ),
          )
        }
      }
    }

    return {
      ruleId: 'cv-nice-quantifiable',
      category: 'NICE_TO_HAVE',
      passed: found,
      severity: 'warning',
      reason: found
        ? `Found ${foundEvidence.length} quantifiable achievement(s)`
        : 'Consider adding quantifiable achievements (e.g., "increased performance by 20%")',
      evidence: foundEvidence.length > 0 ? foundEvidence.slice(0, 3) : [createSectionEvidence(cv.id, 'EXPERIENCE')],
    }
  },
}

// BEST_PRACTICE Rules
const hasActivitiesSection: CvQualityRule = {
  ruleId: 'cv-best-activities-section',
  category: 'BEST_PRACTICE',
  severity: 'info',
  description: 'CV could include Activities or Extracurriculars',
  evaluate: (cv) => {
    const activitiesSection = cv.sections.find((s) => s.type === 'ACTIVITIES')
    const passed = !!activitiesSection
    return {
      ruleId: 'cv-best-activities-section',
      category: 'BEST_PRACTICE',
      passed,
      severity: 'info',
      reason: passed ? 'Activities section found' : 'Activities section can showcase leadership and soft skills',
      evidence:
        passed && activitiesSection
          ? [createSectionEvidence(cv.id, 'ACTIVITIES', activitiesSection.id)]
          : [createSectionEvidence(cv.id, 'ACTIVITIES')],
    }
  },
}

const hasActionVerbs: CvQualityRule = {
  ruleId: 'cv-best-action-verbs',
  category: 'BEST_PRACTICE',
  severity: 'info',
  description: 'CV bullets should start with action verbs',
  evaluate: (cv) => {
    const actionVerbs = [
      'developed',
      'created',
      'built',
      'designed',
      'implemented',
      'led',
      'managed',
      'improved',
      'achieved',
      'increased',
      'reduced',
      'launched',
      'delivered',
      'coordinated',
      'established',
    ]
    let actionVerbCount = 0
    let totalBullets = 0
    const goodExamples: EvidenceType[] = []

    for (const section of cv.sections) {
      if (['EXPERIENCE', 'PROJECTS'].includes(section.type)) {
        for (const chunk of section.chunks) {
          totalBullets++
          const firstWord = chunk.content.trim().split(/\s+/)[0]?.toLowerCase()
          if (firstWord && actionVerbs.includes(firstWord)) {
            actionVerbCount++
            if (goodExamples.length < 2) {
              goodExamples.push(
                createChunkEvidence(
                  cv.id,
                  section.type,
                  section.id,
                  chunk.id,
                  chunk.order,
                  chunk.content.substring(0, 80),
                ),
              )
            }
          }
        }
      }
    }

    const ratio = totalBullets > 0 ? actionVerbCount / totalBullets : 0
    const passed = ratio >= 0.5

    return {
      ruleId: 'cv-best-action-verbs',
      category: 'BEST_PRACTICE',
      passed,
      severity: 'info',
      reason: passed
        ? `${Math.round(ratio * 100)}% of bullets start with action verbs`
        : `Only ${Math.round(ratio * 100)}% of bullets start with action verbs - aim for 50%+`,
      evidence: goodExamples.length > 0 ? goodExamples : [createSectionEvidence(cv.id, 'EXPERIENCE')],
    }
  },
}

const appropriateLength: CvQualityRule = {
  ruleId: 'cv-best-appropriate-length',
  category: 'BEST_PRACTICE',
  severity: 'info',
  description: 'CV should have appropriate content length for fresher level',
  evaluate: (cv) => {
    const totalChunks = cv.sections.reduce((acc, s) => acc + s.chunks.length, 0)
    const passed = totalChunks >= 10 && totalChunks <= 50

    return {
      ruleId: 'cv-best-appropriate-length',
      category: 'BEST_PRACTICE',
      passed,
      severity: 'info',
      reason: passed
        ? `CV has ${totalChunks} bullet points (appropriate for fresher)`
        : totalChunks < 10
          ? `CV only has ${totalChunks} bullet points - consider adding more detail`
          : `CV has ${totalChunks} bullet points - consider being more concise`,
      evidence: [createSectionEvidence(cv.id, 'SUMMARY')],
    }
  },
}

// Export all rules
export const CV_QUALITY_RULES: CvQualityRule[] = [
  // MUST_HAVE
  hasEducationSection,
  hasContactInfo,
  hasExperienceOrProjects,
  // NICE_TO_HAVE
  hasSkillsSection,
  hasSummarySection,
  hasQuantifiableAchievements,
  // BEST_PRACTICE
  hasActivitiesSection,
  hasActionVerbs,
  appropriateLength,
]
