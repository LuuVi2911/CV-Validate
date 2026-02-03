import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'
import { PrismaService } from '../shared/services/prisma.service'

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(AppModule, {
        logger: ['error'],
    })

    try {
        const prisma = app.get(PrismaService)

        // Get all rule sets
        const ruleSets = await prisma.ruleSet.findMany({
            include: {
                rules: {
                    include: {
                        chunks: true,
                    },
                },
            },
        })

        console.log('\n=== RULE SETS IN DATABASE ===\n')

        for (const ruleSet of ruleSets) {
            console.log(`RuleSet: ${ruleSet.key}`)
            console.log(`Version: ${ruleSet.version}`)
            console.log(`Source: ${ruleSet.sourcePdf}`)
            console.log(`Rules: ${ruleSet.rules.length}`)
            console.log(`Total Chunks: ${ruleSet.rules.reduce((sum, r) => sum + r.chunks.length, 0)}`)
            console.log('\nRules:')

            for (const rule of ruleSet.rules) {
                console.log(`\n  ${rule.ruleKey}: ${rule.title || '(no title)'}`)
                console.log(`  Category: ${rule.category}, Severity: ${rule.severity}, Strategy: ${rule.strategy}`)
                console.log(`  Content length: ${rule.content.length} chars`)
                console.log(`  Chunks: ${rule.chunks.length}`)
                console.log(`  Content preview: ${rule.content.slice(0, 200)}...`)
            }

            console.log('\n' + '='.repeat(60) + '\n')
        }
    } catch (error) {
        console.error('Error:', error)
    } finally {
        await app.close()
    }
}

bootstrap()
