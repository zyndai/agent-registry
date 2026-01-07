import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  NotFoundException,
  HttpCode,
  HttpStatus,
  UseGuards,
  Res,
} from '@nestjs/common';
import { AgentsService } from './agents.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto, UpdateMqttDto, UpdateWebhookDto } from './dto/update-agent.dto';
import { AgentQueryDto } from './dto/agent-query.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { Agent } from '@prisma/client';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { CurrentUser } from 'src/decorators';
import { APIKeyAuthGuard } from 'src/auth/apikey-auth.guard';
import { Response } from "express";

@ApiTags('agents')
@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) { }

  @Post()
  @ApiOperation({ summary: 'Register a new agent' })
  @ApiResponse({
    status: 201,
    description: 'The agent has been successfully created',
    type: Object,
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or missing authentication' })
  @UseGuards(JwtAuthGuard)
  @ApiSecurity('api-key')
  async createAgent(@Body() createAgentDto: CreateAgentDto, @CurrentUser() user): Promise<Agent> {
    return this.agentsService.createAgent(user.userId, createAgentDto);
  }


  @Post("n8n")
  @ApiOperation({ summary: 'Register a new n8n agent' })
  @ApiResponse({
    status: 201,
    description: 'The agent has been successfully created',
    type: Object,
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or missing authentication' })
  @UseGuards(APIKeyAuthGuard)
  @ApiSecurity('api-key')
  async createN8NAgent(@Body() createN8NAgentDto: any, @Res({ passthrough: true }) res: Response, @CurrentUser() user: any): Promise<Agent> {
    const [alreadyExisted, agent] = await this.agentsService.createN8NAgent(user.userId, createN8NAgentDto);

    if (alreadyExisted) {
      res.status(HttpStatus.OK);
    } else {
      res.status(HttpStatus.CREATED);
    }

    return agent;
  }

  @Get("get-my-agents")
  @ApiOperation({ summary: 'Get all agents of an User' })
  @ApiResponse({
    status: 200,
    description: 'List of agents',
    type: [Object],
  })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiSecurity('bearer')
  async getMyAgents(@CurrentUser() user): Promise<Agent[]> {
    return this.agentsService.getMyAgetns(user.userId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all agents with optional filtering' })
  @ApiResponse({
    status: 200,
    description: 'List of agents',
    type: [Object],
  })
  async getAgents(@Query() query: AgentQueryDto): Promise<{
    data: Omit<Agent, 'seed'>[];
    count: number;
    total: number;
  }> {
    return this.agentsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get agent by ID' })
  @ApiParam({ name: 'id', description: 'Agent ID' })
  @ApiResponse({
    status: 200,
    description: 'The agent details',
    type: Object,
  })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiSecurity('bearer')
  async getAgent(@Param('id') id: string, @CurrentUser() user): Promise<{ agent: Agent, credentials: any }> {
    const agent = await this.agentsService.findOne(id, user.userId as number);
    if (!agent) {
      throw new NotFoundException(`Agent with ID ${id} not found`);
    }
    return agent;
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update agent information' })
  @ApiParam({ name: 'id', description: 'Agent ID' })
  @ApiResponse({
    status: 200,
    description: 'The agent has been successfully updated',
    type: Object,
  })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiSecurity('bearer')
  async updateAgent(
    @Param('id') id: string,
    @Body() updateAgentDto: UpdateAgentDto,
    @CurrentUser() user
  ): Promise<Agent> {
    return this.agentsService.updateAgent(id, updateAgentDto, user.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete agent' })
  @ApiParam({ name: 'id', description: 'Agent ID' })
  @ApiResponse({
    status: 204,
    description: 'The agent has been successfully deleted',
  })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiSecurity('bearer')
  async deleteAgent(@Param('id') id: string, @CurrentUser() user): Promise<void> {
    return this.agentsService.removeAgent(id, user.userId);
  }


  @Post('/update-mqtt')
  @ApiOperation({ summary: 'Update Mqtt Info' })
  @ApiResponse({
    status: 200,
    description: 'The agent has been successfully Updated',
  })
  async updateMqtt(@Body() updateMqttDto: UpdateMqttDto): Promise<void> {
    await this.agentsService.updateMqtt(updateMqttDto.seed, updateMqttDto.mqttUri);
  }


  @Post('/update-webhook')
  @ApiOperation({ summary: 'Update Http Webhook Url' })
  @ApiResponse({
    status: 200,
    description: 'The agent has been successfully Updated',
  })
  @UseGuards(APIKeyAuthGuard)
  @ApiSecurity('api-key')
  async updateHttpWebhookUrl(@Body() updateWebhookDto: UpdateWebhookDto, @CurrentUser() user: any): Promise<void> {
    await this.agentsService.updateHttpWebhookUrl(user.userId, updateWebhookDto.httpWebhookUrl, updateWebhookDto.agentId);
  }
}
