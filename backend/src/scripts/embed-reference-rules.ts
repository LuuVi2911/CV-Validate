import { GoogleGenerativeAI } from '@google/generative-ai'
import { PrismaService } from '../shared/services/prisma.service'
import envConfig from '../shared/config'

/**
 * Embed Reference Rules
 * 
 * This script embeds the descriptions of reference rules for semantic classification.
 * Run after seeding reference rules.
 */
async function main() {
    if (!envConfig.GEMINI_API_KEY) {
        console.error('GEMINI_API_KEY not configured')
        process.exit(1)
    }

    const prismaService = new PrismaService()
    const genAI = new GoogleGenerativeAI(envConfig.GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({ model: envConfig.EMBEDDING_MODEL })

    console.log('Embedding reference rules...')

    const rules = await prismaService.referenceRule.findMany()

    console.log(`Found ${rules.length} reference rules to embed`)

    for (const rule of rules) {
        // Combine title and description for richer semantic representation
        const textToEmbed = `${rule.title}: ${rule.description}`

        const result = await model.embedContent(textToEmbed)
        const embedding = result.embedding.values
        const embeddingString = `[${embedding.join(',')}]`

        await prismaService.$executeRaw`
      UPDATE "ReferenceRule"
      SET embedding = ${embeddingString}::vector
      WHERE id = ${rule.id}
    `

        console.log(`✅ Embedded: ${rule.title}`)
    }

    console.log(`✅ Successfully embedded ${rules.length} reference rules`)

    await prismaService.$disconnect()
}

main()
    .catch((e) => {
        console.error('Error embedding reference rules:', e)
        process.exit(1)
    })
