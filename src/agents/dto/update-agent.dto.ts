import { IsString, IsOptional, IsObject, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AgentStatus } from '@prisma/client';

export class UpdateAgentDto {
  @IsString()
  @IsOptional()
  @ApiPropertyOptional({ description: 'Name of the agent' })
  name?: string;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional({ description: 'Description of the agent' })
  description?: string;

  @IsObject()
  @IsOptional()
  @ApiPropertyOptional({
    description: 'JSON object describing agent capabilities',
    example: {
      ai: ['nlp', 'vision'],
      integration: ['slack', 'discord'],
      protocols: ['http', 'grpc'],
    },
  })
  capabilities?: Record<string, any>;

  @IsEnum(AgentStatus)
  @IsOptional()
  @ApiPropertyOptional({
    enum: AgentStatus,
    description: 'Current status of the agent',
  })
  status?: AgentStatus;
}



export class UpdateMqttDto {
  @IsString()
  seed: string;

  @IsString()
  mqttUri: string;
}


export class UpdateWebhookDto {
  @IsString()
  agentId: string;
  
  @IsString()
  httpWebhookUrl: string;
}