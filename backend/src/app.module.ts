import { Module } from '@nestjs/common'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { SharedModule } from './shared/shared.module'
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core'
import CustomZodValidationPipe from 'src/shared/pipe/custom-zod-validation.pipe'
import { ZodSerializerInterceptor } from 'nestjs-zod'
import { HttpExceptionFilter } from 'src/shared/filter/http-exception.filter'
import { ThrottlerBehindProxyGuard } from 'src/shared/guard/throttler-behind-proxy.guard.ts'
import { ThrottlerModule } from '@nestjs/throttler'
import { AuthModule } from './routes/auth/auth.module'
import { AuthController } from './routes/auth/auth.controller'

@Module({
  imports: [
    SharedModule,
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'short',
          ttl: 60000,
          limit: 5,
        },
        {
          name: 'long',
          ttl: 120000, // 2 minutes
          limit: 7,
        },
      ],
    }),
    AuthModule,
  ],
  controllers: [AppController, AuthController],

  providers: [
    AppService,
    {
      provide: APP_PIPE,
      useClass: CustomZodValidationPipe,
    },
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerBehindProxyGuard,
    },
  ],
})
export class AppModule {}
