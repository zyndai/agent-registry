import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors();

  const config = new DocumentBuilder()
    .setTitle('P3AI Registry Service API')
    .setDescription('API for the P3AI Agent Registry Service')
    .setVersion('1.0')
    .addTag('agents')
    .addTag('metadata')
    .addBearerAuth()
    .addApiKey(
      {
        type: 'apiKey',
        name: 'x-api-key',
        in: 'header',
        description: 'Enter your API key',
      },
      'api-key',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // Enable Prisma shutdown hook
  const prismaService = app.get(PrismaService);
  // await prismaService.enableShutdownHooks(app);

  // Start the server
  const port = configService.get<number>('PORT', 3000);
  await app.listen(port, '127.0.0.1');

  console.log(`P3AI registry service is running on: ${await app.getUrl()}`);
}
bootstrap();
