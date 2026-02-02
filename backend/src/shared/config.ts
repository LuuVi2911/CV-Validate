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
})

const configServer = configSchema.safeParse(process.env)
if (!configServer.success) {
  console.log('Invalid values in .env file')
  console.error(configServer.error)
  process.exit(1)
}

const envConfig = configServer.data

export default envConfig
