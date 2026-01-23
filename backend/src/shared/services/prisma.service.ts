import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from 'src/generated/prisma/client'
import envConfig from '../config'

/**
 * PrismaService with connection pooling configuration.
 *
 * Connection Pool Settings:
 * - connection_limit: 20 connections per pool
 * - pool_timeout: 20 seconds max wait time for connection
 *
 * For production, consider using an external connection pooler like PgBouncer.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // Add connection pooling parameters to database URL
    const databaseUrl = new URL(envConfig.DATABASE_URL)
    databaseUrl.searchParams.set('connection_limit', '20')
    databaseUrl.searchParams.set('pool_timeout', '20')

    const adapter = new PrismaPg({
      connectionString: databaseUrl.toString(),
    })
    super({ adapter, log: ['info'] })
  }

  async onModuleInit() {
    await this.$connect()
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }
}
