import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PrismaService } from './prisma/prisma.service';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AgentsModule } from './agents/agents.module';
import { MetadataModule } from './metadata/metadata.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { UtilsModule } from './utils/utils.module';
import { EmbeddingsModule } from './embeddings/embeddings.module';
import { HealthCheckModule } from './health-check/health-check.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    AgentsModule,
    EmbeddingsModule,
    MetadataModule,
    UsersModule,
    AuthModule,
    UtilsModule,
    HealthCheckModule,
  ],
  controllers: [AppController],
  providers: [PrismaService],
})
export class AppModule { }
