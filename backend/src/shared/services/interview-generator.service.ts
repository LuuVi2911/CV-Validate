import { Injectable } from '@nestjs/common'
import { GoogleGenerativeAI } from '@google/generative-ai'
import envConfig from '../config'
import type { MockQuestionType } from 'src/routes/evaluation/evaluation.model'
import { LoggerService } from './logger.service'

export interface InterviewGeneratorInput {
    cvContent: string
    jdContent: string
}

@Injectable()
export class InterviewGeneratorService {
    private genAI: GoogleGenerativeAI | null = null
    private readonly model = 'gemini-2.0-flash'

    constructor(private readonly logger: LoggerService) {
        if (envConfig.GEMINI_API_KEY) {
            this.genAI = new GoogleGenerativeAI(envConfig.GEMINI_API_KEY)
        }
    }

    async generateQuestions(input: InterviewGeneratorInput): Promise<MockQuestionType[]> {
        if (!this.genAI) {
            this.logger.logWarning('Gemini API key not configured, skipping initial mock questions')
            return []
        }

        try {
            const model = this.genAI.getGenerativeModel({ model: this.model })

            const prompt = `
        You are an elite technical interviewer. Generate 3-5 high-quality interview questions based on the provided CV and Job Description (JD).
        
        GOALS:
        1. Identify the primary technologies, tools, and frameworks mentioned in the CV that align with the requirements in the JD.
        2. Focus the questions on these technologies.
        3. Ask questions that require the candidate to explain how they solved REAL-WORLD problems using those technologies.
        4. Include a mix of technical deep-dives, problem-solving scenarios, and COMPARATIVE questions.
        
        QUESTION TYPES:
        - **Technical**: Deep dive into a specific tool or framework mentioned in the CV.
        - **Problem-Solving**: Present a realistic challenge related to the JD role and ask how they'd use their skills to address it.
        - **Comparative**: Ask the candidate to compare two related technologies they've used or could have used, explaining trade-offs and why they chose one over the other. 
          Examples: "Why did you choose WebSocket over SSE?", "How does SQL compare to NoSQL for your use case?", "What made you use Redux instead of Context API?"
        
        CV CONTENT:
        "${input.cvContent}"
        
        JD CONTENT:
        "${input.jdContent}"
        
        INSTRUCTIONS:
        - Return ONLY a JSON array of objects.
        - Each object must follow this structure:
          {
            "question": "The interview question text",
            "expectedTopics": ["topic1", "topic2"],
            "difficulty": "easy" | "medium" | "hard",
            "type": "technical" | "behavioral" | "problem-solving"
          }
        - Ensure the questions are specific to the candidate's background as described in the CV.
        - Include at least ONE comparative question that tests understanding of technology trade-offs.
      `

            const result = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 1024,
                    responseMimeType: 'application/json',
                },
            })

            // Log token usage
            const usage = result.response.usageMetadata
            if (usage) {
                this.logger.logTokenUsage({
                    service: 'InterviewGeneratorService',
                    operation: 'generateQuestions',
                    inputTokens: usage.promptTokenCount,
                    outputTokens: usage.candidatesTokenCount,
                    totalTokens: usage.totalTokenCount,
                    model: this.model,
                })
            }

            const responseText = result.response.text()
            const parsed = JSON.parse(responseText.trim())

            if (Array.isArray(parsed)) {
                return parsed.map(q => ({
                    question: String(q.question),
                    expectedTopics: Array.isArray(q.expectedTopics) ? q.expectedTopics.map(String) : [],
                    difficulty: q.difficulty || 'medium',
                    type: q.type || 'technical'
                }))
            }

            return []
        } catch (error) {
            this.logger.logError(error as Error, {
                service: 'InterviewGeneratorService',
                operation: 'generateQuestions',
            })
            return []
        }
    }
}
