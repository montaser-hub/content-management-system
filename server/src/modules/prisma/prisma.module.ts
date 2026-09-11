import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * @Global so every feature module can inject PrismaService without each one
 * re-importing PrismaModule — there is exactly one database connection pool
 * for the whole process, and every module shares it.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
