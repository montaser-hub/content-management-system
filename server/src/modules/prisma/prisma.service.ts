import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { AppConfig } from '../../config/configuration';
import { PrismaClient } from '../../generated/prisma/client.js';

/**
 * Wraps PrismaClient as an injectable, testable Nest provider.
 *
 * As of Prisma 7 there is no bundled Rust query engine — PrismaClient talks
 * to Postgres through a driver adapter (`@prisma/adapter-pg`, built on the
 * `pg` package) instead. That adapter is constructed here, once, from the
 * validated `DATABASE_URL`, rather than left for Prisma to resolve from
 * schema.prisma (which no longer holds the connection string at all).
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService<AppConfig, true>) {
    const adapter = new PrismaPg({
      connectionString: config.getOrThrow('database.url', { infer: true }),
    });

    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Connected to PostgreSQL');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
