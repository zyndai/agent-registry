import { IsOptional, IsEnum, IsString, IsArray } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AgentStatus } from '@prisma/client';

export class AgentQueryDto {
  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    description: 'Search by keyword (case-insensitive, partial match across name, description, capabilities, metadata)',
    example: 'assistant',
  })
  keyword?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    description: 'Filter by name (case-insensitive, partial match)',
  })
  name?: string;

  @IsOptional()
  @IsEnum(AgentStatus)
  @ApiPropertyOptional({
    enum: AgentStatus,
    description: 'Filter by agent status',
  })
  status?: AgentStatus;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    return typeof value === 'string' ? value.split(',') : value;
  })
  @ApiPropertyOptional({
    description: 'Filter by capabilities (comma separated)',
    example: 'nlp,vision',
    type: [String],
  })
  capabilities?: string[];

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'Filter by DID (exact match)' })
  did?: string;

  @IsOptional()
  @Type(() => Number)
  @ApiPropertyOptional({
    description: 'The number of items to return',
    default: 10,
    minimum: 1,
    maximum: 100,
  })
  limit?: number = 10;

  @IsOptional()
  @Type(() => Number)
  @ApiPropertyOptional({
    description: 'The number of items to skip',
    default: 0,
    minimum: 0,
  })
  offset?: number = 0;
}
