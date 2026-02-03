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
  // Evaluation configuration (optional with defaults)
  GEMINI_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().default('text-embedding-004'),
  EMBEDDING_DIM: z.coerce.number().int().default(768),
  MATCH_TOP_K: z.coerce.number().int().default(5),
  SIM_FLOOR: z.coerce.number().default(0.15),
  SIM_LOW_THRESHOLD: z.coerce.number().default(0.4),
  SIM_HIGH_THRESHOLD: z.coerce.number().default(0.75),
  LLM_JUDGE_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
})

const configServer = configSchema.safeParse(process.env)
if (!configServer.success) {
  console.log('Invalid values in .env file')
  console.error(configServer.error)
  process.exit(1)
}

const envConfig = configServer.data

export default envConfig
