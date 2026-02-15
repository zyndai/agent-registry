import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { UtilsService } from './utils.service';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import { User } from '@prisma/client';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { CurrentUser } from 'src/decorators';
import { CollectMailDto } from './dto/collect-mail.dto';
import { JoinWaitlistDto } from './dto/join-waitlist.dto';
import { PrismaService } from 'src/prisma/prisma.service';

@Controller('utils')
export class UtilsController {
  constructor(
    private readonly utilsService: UtilsService,
    private readonly prismaService: PrismaService,
  ) {}

  @Post('mail-collector')
  async collectMail(@Body() collectMailDto: CollectMailDto) {
    return this.utilsService.collectMail(collectMailDto);
  }

  @Post('waitlist')
  @ApiOperation({ summary: 'Join the waitlist' })
  @ApiResponse({ status: 201, description: 'Successfully joined the waitlist' })
  @ApiResponse({ status: 409, description: 'Email already on the waitlist' })
  async joinWaitlist(@Body() joinWaitlistDto: JoinWaitlistDto) {
    return this.utilsService.joinWaitlist(joinWaitlistDto);
  }

  @Get('registry-info')
  @ApiOperation({ summary: 'Get registry Insights' })
  @ApiResponse({
    status: 200,
    description: 'get count of registered agents',
    type: Object,
  })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async registryInfo() {
    const registeredEvents = await this.prismaService.agent.count();
    return {
      registered_agents: registeredEvents,
    };
  }
}
