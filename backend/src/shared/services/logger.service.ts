import { Injectable } from '@nestjs/common'

export interface TokenUsageContext {
    service: string
    operation: string
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    model: string
    userId?: string
    requestId?: string
}

export interface ErrorContext {
    service?: string
    operation?: string
    path?: string
    method?: string
    userId?: string
    requestId?: string
    [key: string]: any
}

@Injectable()
export class LoggerService {
    /**
     * Log token usage for Gemini API calls
     */
    logTokenUsage(context: TokenUsageContext) {
        console.log(
            JSON.stringify({
                type: 'TOKEN_USAGE',
                timestamp: new Date().toISOString(),
                ...context,
            }),
        )
    }

    /**
     * Log errors with structured context
     */
    logError(error: Error | unknown, context?: ErrorContext) {
        const errorObj = error instanceof Error ? error : new Error(String(error))

        console.error(
            JSON.stringify({
                type: 'ERROR',
                timestamp: new Date().toISOString(),
                message: errorObj.message,
                stack: errorObj.stack,
                ...context,
            }),
        )
    }

    /**
     * Log HTTP requests
     */
    logRequest(req: any, statusCode: number, duration: number) {
        console.log(
            JSON.stringify({
                type: 'REQUEST',
                timestamp: new Date().toISOString(),
                method: req.method,
                path: req.path || req.url,
                statusCode,
                duration,
                userId: req.user?.userId,
            }),
        )
    }

    /**
     * Log general info
     */
    logInfo(message: string, context?: Record<string, any>) {
        console.log(
            JSON.stringify({
                type: 'INFO',
                timestamp: new Date().toISOString(),
                message,
                ...context,
            }),
        )
    }

    /**
     * Log warnings
     */
    logWarning(message: string, context?: Record<string, any>) {
        console.warn(
            JSON.stringify({
                type: 'WARNING',
                timestamp: new Date().toISOString(),
                message,
                ...context,
            }),
        )
    }
}
