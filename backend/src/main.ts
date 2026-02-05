import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import envConfig from './shared/config'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  // CORS Configuration
  app.enableCors({
    origin: envConfig.CORS_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })

  await app.listen(process.env.PORT ?? 3000)
  console.log(`Application is running on: http://localhost:${process.env.PORT ?? 3000}`)
}
bootstrap()
