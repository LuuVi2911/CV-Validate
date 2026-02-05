import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { config } from 'dotenv'

config({ path: '.env' })

if (!fs.existsSync(path.resolve('.env'))) {
  console.log('.env file not found')
  process.exit(1)
}

const configSchema = z.object({
  DATABASE_URL: z.string(),
  ACCESS_TOKEN_SECRET: z.string(),
  ACCESS_TOKEN_EXPIRES_IN: z.string(),
  REFRESH_TOKEN_SECRET: z.string(),
  REFRESH_TOKEN_EXPIRES_IN: z.string(),
  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_SECRET: z.string(),
  GOOGLE_REDIRECT_URI: z.string(),
  RESEND_API_KEY: z.string(),
  // Evaluation configuration 
  GEMINI_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string(),
  EMBEDDING_DIM: z.coerce.number().int(),
  MATCH_TOP_K: z.coerce.number().int(),
  SIM_FLOOR: z.coerce.number(),
  SIM_LOW_THRESHOLD: z.coerce.number(),
  SIM_HIGH_THRESHOLD: z.coerce.number(),
  LLM_JUDGE_ENABLED: z.coerce.boolean().default(true),
  LLM_JUDGE_BATCH_SIZE: z.coerce.number().int(),

  // Multi-mention aggregation (boost confidence when skill appears multiple times)
  MULTI_MENTION_THRESHOLD: z.coerce.number().int().default(3),
  MULTI_MENTION_HIGH_SIMILARITY: z.coerce.number().default(0.6),
  DEDUP_SIMILARITY_THRESHOLD: z.coerce.number().default(0.95),

  // CORS Configuration
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  // Rate Limiting
  RATE_LIMIT_SHORT_TTL: z.coerce.number().int().default(60000), // 1 minute
  RATE_LIMIT_SHORT_MAX: z.coerce.number().int().default(10),
  RATE_LIMIT_LONG_TTL: z.coerce.number().int().default(3600000), // 1 hour
  RATE_LIMIT_LONG_MAX: z.coerce.number().int().default(100),

  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  RULE_CLASSIFICATION_HIGH_THRESHOLD: z.coerce.number().default(0.8),
  RULE_CLASSIFICATION_AMBIGUOUS_THRESHOLD: z.coerce.number().default(0.5),
  SEMANTIC_CLASSIFICATION_ENABLED: z.coerce.boolean().default(true),
})

const configServer = configSchema.safeParse(process.env)
if (!configServer.success) {
  console.log('Invalid values in .env file')
  console.error(configServer.error)
  process.exit(1)
}

const envConfig = configServer.data

export default envConfig
