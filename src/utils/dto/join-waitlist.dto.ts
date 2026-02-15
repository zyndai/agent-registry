import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WaitlistRole } from '@prisma/client';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';

export class JoinWaitlistDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email address',
  })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    example: 'https://linkedin.com/in/johndoe',
    description: 'LinkedIn profile URL',
  })
  @IsOptional()
  @IsString()
  linkedinProfile?: string;

  @ApiProperty({
    enum: WaitlistRole,
    example: WaitlistRole.BUILDER,
    description: 'I am a builder/founder/investor/researcher/student/other',
  })
  @IsEnum(WaitlistRole)
  role: WaitlistRole;

  @ApiPropertyOptional({
    example: 'An AI-powered agent marketplace',
    description: 'What are you building?',
  })
  @IsOptional()
  @IsString()
  building?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Attending the AI Summit?',
  })
  @IsOptional()
  @IsBoolean()
  attendingAiSummit?: boolean = false;
}
