import { PrismaService } from '../shared/services/prisma.service'
import type { RuleType } from '../generated/prisma/enums'

const prisma = new PrismaService()

/**
 * Reference rules extracted from Match JD rules PDF
 * These serve as canonical examples for semantic classification
 */
const REFERENCE_RULES: Array<{
    category: RuleType
    title: string
    description: string
    examples: string[]
}> = [
        // ============================================================================
        // MUST_HAVE Reference Rules
        // ============================================================================
        {
            category: 'MUST_HAVE',
            title: 'Required Skill Coverage',
            description: 'Core technical skills or tools that are explicitly required for the role',
            examples: [
                'Must have experience with React and TypeScript',
                'Required: 2+ years of Python development',
                'Essential knowledge of SQL databases',
                'Minimum 1 year experience with AWS',
                'Mandatory proficiency in Java',
            ],
        },
        {
            category: 'MUST_HAVE',
            title: 'Skill Usage Evidence',
            description: 'Demonstrated application of required skills in real projects or work',
            examples: [
                'Must demonstrate hands-on experience building REST APIs',
                'Required evidence of deploying production applications',
                'Need to show experience with agile development',
                'Must have built scalable systems',
            ],
        },
        {
            category: 'MUST_HAVE',
            title: 'Role Type Consistency',
            description: 'Alignment with the fundamental nature of the role (frontend, backend, full-stack, etc.)',
            examples: [
                'Backend developer position',
                'Full-stack engineer role',
                'Frontend specialist required',
                'DevOps engineer position',
            ],
        },
        {
            category: 'MUST_HAVE',
            title: 'Level Fit',
            description: 'Experience level or seniority requirements',
            examples: [
                'Entry-level developer position',
                'Junior engineer role',
                'Internship opportunity',
                'Fresh graduate welcome',
                'Student or recent graduate',
            ],
        },

        // ============================================================================
        // NICE_TO_HAVE Reference Rules
        // ============================================================================
        {
            category: 'NICE_TO_HAVE',
            title: 'Skill Depth Alignment',
            description: 'Advanced or specialized knowledge that enhances fit but is not required',
            examples: [
                'Preferred: Deep understanding of microservices architecture',
                'Bonus: Experience with GraphQL',
                'Nice to have: Knowledge of Docker and Kubernetes',
                'Plus: Familiarity with CI/CD pipelines',
                'Advantage: Understanding of design patterns',
            ],
        },
        {
            category: 'NICE_TO_HAVE',
            title: 'Tool or Environment Overlap',
            description: 'Specific tools, frameworks, or development environments that would be beneficial',
            examples: [
                'Preferred experience with VS Code',
                'Bonus: Familiarity with Jira and Confluence',
                'Nice to have: Experience with Git workflows',
                'Plus: Knowledge of testing frameworks like Jest',
            ],
        },
        {
            category: 'NICE_TO_HAVE',
            title: 'Task and Responsibility Alignment',
            description: 'Experience with specific types of tasks or responsibilities relevant to the role',
            examples: [
                'Preferred: Experience with code reviews',
                'Bonus: Background in mentoring junior developers',
                'Nice to have: Experience writing technical documentation',
                'Plus: Involvement in sprint planning',
            ],
        },
        {
            category: 'NICE_TO_HAVE',
            title: 'Domain Familiarity',
            description: 'Knowledge of the business domain or industry',
            examples: [
                'Preferred: Experience in fintech or banking',
                'Bonus: Background in e-commerce',
                'Nice to have: Understanding of healthcare regulations',
                'Plus: Familiarity with SaaS business models',
            ],
        },

        // ============================================================================
        // BEST_PRACTICE Reference Rules
        // ============================================================================
        {
            category: 'BEST_PRACTICE',
            title: 'Directly Relevant Experience or Project',
            description: 'Past work or projects that closely match the role requirements',
            examples: [
                'Built a similar e-commerce platform',
                'Developed a mobile app with React Native',
                'Created a data pipeline using Apache Spark',
                'Implemented authentication systems',
            ],
        },
        {
            category: 'BEST_PRACTICE',
            title: 'Relevant Outcomes',
            description: 'Measurable achievements or impact from past work',
            examples: [
                'Improved application performance by 40%',
                'Reduced deployment time from hours to minutes',
                'Increased test coverage to 90%',
                'Scaled system to handle 1M users',
            ],
        },
        {
            category: 'BEST_PRACTICE',
            title: 'Learning and Adaptability Signals',
            description: 'Evidence of continuous learning, problem-solving, and adaptability',
            examples: [
                'Self-taught in new technologies',
                'Completed online courses or certifications',
                'Contributed to open-source projects',
                'Participated in hackathons or coding competitions',
                'Quick learner with ability to adapt',
            ],
        },
    ]

async function main() {
    console.log('Seeding reference rules...')

    // Clear existing reference rules
    await prisma.referenceRule.deleteMany({})

    // Insert reference rules
    for (const rule of REFERENCE_RULES) {
        await prisma.referenceRule.create({
            data: {
                category: rule.category,
                title: rule.title,
                description: rule.description,
                examples: rule.examples,
                // Embedding will be added later via embed-reference-rules script
            },
        })
    }

    console.log(`✅ Seeded ${REFERENCE_RULES.length} reference rules`)
}

main()
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
