import { Module } from '@nestjs/common';
import { HealthCheckService } from './health-check.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  providers: [HealthCheckService, PrismaService],
})
export class HealthCheckModule {}
