import { NestFactory } from '@nestjs/core'
import * as fs from 'fs'
import * as path from 'path'
import { AppModule } from '../app.module'
import { PdfTextService } from '../shared/services/pdf-text.service'

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(AppModule, {
        logger: ['error'],
    })

    try {
        const pdfTextService = app.get(PdfTextService)
        const pdfPath = path.resolve(__dirname, '../rules/student-fresher/Rule For Student.pdf')
        const buffer = fs.readFileSync(pdfPath)
        const text = await pdfTextService.extractText(buffer)

        console.log('=== FULL PDF TEXT ===\n')
        console.log(text)
        console.log('\n=== END ===\n')

        // Find all lines that might be rule headers
        const lines = text.split('\n')
        console.log('\n=== POTENTIAL RULE HEADERS ===\n')

        for (const line of lines) {
            if (line.includes('S-MH-') || line.includes('S-NH-') || line.includes('S-BP-')) {
                console.log(`FOUND: ${line}`)
            }
        }
    } catch (error) {
        console.error('Error:', error)
    } finally {
        await app.close()
    }
}

bootstrap()
