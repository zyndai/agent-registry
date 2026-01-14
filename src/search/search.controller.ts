import { Controller, Get, Query } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Agent } from '@prisma/client';

@ApiTags('search')
@Controller('search/agents')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({
    summary: 'Search for agents by capabilities and keywords',
    description:
      'Intelligently routes to keyword search or capability-based search. ' +
      'Use keyword for simple text search. Add capabilities for filtered results.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of matching agents with pagination',
    type: Object,
  })
  async searchAgents(@Query() query: SearchQueryDto): Promise<{
    data: Agent[];
    count: number;
    total: number;
  }> {
    // Use the main search method which has intelligent routing
    return this.searchService.searchAgents(query);
  }

}
