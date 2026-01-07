import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Agent, Prisma } from '@prisma/client';
import { SearchQueryDto } from './dto/search-query.dto';
import { EmbeddingsService } from 'src/embeddings/embeddings.service';

@Injectable()
export class SearchService {
  constructor(
    private prisma: PrismaService,
    private embeddingsService: EmbeddingsService,
  ) { }

  /**
   * Main search entrypoint
   * Routes to semantic search when keyword/capabilities provided for better results
   */
  async searchAgents(query: SearchQueryDto): Promise<{
    data: Agent[];
    count: number;
    total: number;
  }> {
    const { keyword, capabilities, status, limit = 10, offset = 0 } = query;

    // Use semantic search when we have search criteria (keyword or capabilities)
    // This provides better, more intelligent results using vector embeddings
    if (keyword || (capabilities && capabilities.length > 0)) {
      console.log('[Search] Routing to semantic search');
      return this.searchAgentsWithSemantics(query);
    }

    // Fallback to basic search if no search criteria (just listing agents)
    console.log('[Search] No search criteria, using basic listing');
    return this.searchByKeyword(keyword, status, limit, offset);
  }

  /**
   * Semantic search with vector similarity + capability filtering
   */
  async searchAgentsWithSemantics(query: SearchQueryDto): Promise<{
    data: Agent[];
    count: number;
    total: number;
  }> {
    const { keyword, capabilities, status, limit = 10, offset = 0 } = query;

    try {
      // Combine keyword and capabilities into search text
      const searchText = [keyword, ...(capabilities || [])]
        .filter(Boolean)
        .join(' ');

      if (!searchText) {
        throw new Error('Search text cannot be empty for semantic search');
      }

      console.log('[Semantic Search] Query:', searchText);

      // Generate embedding for the search query
      const queryEmbedding =
        await this.embeddingsService.generateEmbedding(searchText);

      console.log(
        '[Semantic Search] Generated embedding with',
        queryEmbedding.length,
        'dimensions',
      );

      // Build the SQL query with vector similarity
      let sql = `
      WITH ranked_agents AS (
        SELECT
          a.id, a."didIdentifier", a.did, a.name, a.description, a.capabilities,
          a."connectionString", a.status, a."createdAt", a."updatedAt", a."ownerId",
          a.seed, a."mqttUri", a."inboxTopic", a."httpWebhookUrl",
          (1 - (a.embedding <=> $1::vector)) AS similarity_score
        FROM "agents" AS a
        WHERE a.embedding IS NOT NULL
    `;

      // CRITICAL FIX: Use JSON.stringify for proper vector formatting
      const params: any[] = [JSON.stringify(queryEmbedding)];
      let paramIndex = 2;

      // Status filter
      if (status) {
        sql += ` AND a.status = $${paramIndex}::"AgentStatus"`;
        params.push(status);
        paramIndex++;
      }

      // Capability filter - fuzzy match across ALL capability categories
      // Changed from exact match to ILIKE for partial/case-insensitive matching
      if (capabilities && capabilities.length > 0) {
        const capConditions = capabilities.map((_, i) => {
          const paramIdx = paramIndex + i;
          return `EXISTS (
            SELECT 1
            FROM jsonb_each(a.capabilities) AS cap(key, value)
            WHERE jsonb_typeof(value) = 'array'
              AND EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(value) AS elem
                WHERE elem ILIKE $${paramIdx}
              )
          )`;
        });

        sql += ` AND (${capConditions.join(' OR ')})`;
        capabilities.forEach((cap) => params.push(`%${cap}%`));
        paramIndex += capabilities.length;
      }

      // Similarity threshold (0.5 = 50% similarity minimum)
      // Lowered from 0.7 to be more permissive and return more relevant results
      sql += `
        AND (1 - (a.embedding <=> $1::vector)) > 0.5
      )
      SELECT * FROM ranked_agents
      ORDER BY similarity_score DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

      params.push(limit, offset);

      console.log('[Semantic Search] Executing query with params:', {
        vectorDimensions: queryEmbedding.length,
        status,
        capabilities,
        limit,
        offset,
      });

      // Execute the main query
      const data = await this.prisma.$queryRawUnsafe<any[]>(sql, ...params);

      console.log('[Semantic Search] Found', data.length, 'results');

      // Build count query - reuse same WHERE conditions
      let countSql = `
      WITH ranked_agents AS (
        SELECT a.id
        FROM "agents" AS a
        WHERE a.embedding IS NOT NULL
    `;

      let countParamIndex = 2;

      // Add same filters as main query
      if (status) {
        countSql += ` AND a.status = $${countParamIndex}::"AgentStatus"`;
        countParamIndex++;
      }

      if (capabilities && capabilities.length > 0) {
        const capConditions = capabilities.map((_, i) => {
          const paramIdx = countParamIndex + i;
          return `EXISTS (
            SELECT 1
            FROM jsonb_each(a.capabilities) AS cap(key, value)
            WHERE jsonb_typeof(value) = 'array'
              AND EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(value) AS elem
                WHERE elem ILIKE $${paramIdx}
              )
          )`;
        });

        countSql += ` AND (${capConditions.join(' OR ')})`;
        countParamIndex += capabilities.length;
      }

      countSql += `
        AND (1 - (a.embedding <=> $1::vector)) > 0.5
      )
      SELECT COUNT(*) AS count FROM ranked_agents
    `;

      // Execute count query with same params (excluding limit/offset)
      const countResult = await this.prisma.$queryRawUnsafe<
        [{ count: bigint }]
      >(countSql, ...params.slice(0, -2));

      const total = Number(countResult[0]?.count || 0);

      console.log('[Semantic Search] Total matching agents:', total);

      return { data, count: data.length, total };
    } catch (error) {
      console.error('[Semantic Search] Error:', error);
      throw new Error(
        `Semantic search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Keyword-only search using Prisma (fast, type-safe)
   */
  private async searchByKeyword(
    keyword?: string,
    status?: string,
    limit = 10,
    offset = 0,
  ): Promise<{ data: any; count: number; total: number }> {
    const where: Prisma.AgentWhereInput = {};

    if (status) where.status = status as any;
    if (keyword) {
      where.OR = [
        { name: { contains: keyword, mode: 'insensitive' } },
        { description: { contains: keyword, mode: 'insensitive' } },
        {
          metadata: {
            some: {
              value: { contains: keyword, mode: 'insensitive' },
              visibility: 'PUBLIC',
            },
          },
        },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.agent.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          didIdentifier: true,
          did: true,
          name: true,
          description: true,
          capabilities: true,
          connectionString: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          ownerId: true,
          mqttUri: true,
          inboxTopic: true,
          httpWebhookUrl: true,
          metadata: { where: { visibility: 'PUBLIC' } },
          owner: true,
        },
      }),
      this.prisma.agent.count({ where }),
    ]);

    return { data, count: data.length, total };
  }

  /**
   * Full search with capabilities + keyword (non-semantic)
   */
  private async searchWithCapabilities(
    keyword?: string,
    capabilities?: string[],
    status?: string,
    limit = 10,
    offset = 0,
  ): Promise<{ data: Agent[]; count: number; total: number }> {
    let sql = `
      WITH matching_agents AS (
        SELECT a.*
        FROM "agents" AS a
        WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (status) {
      sql += ` AND a.status = $${paramIndex}::"AgentStatus"`;
      params.push(status);
      paramIndex++;
    }

    // === DYNAMIC CAPABILITY FILTER - SEARCHES ALL CATEGORIES ===
    if (capabilities && capabilities.length > 0) {
      const placeholders = capabilities
        .map((_, i) => `$${paramIndex + i}`)
        .join(', ');
      capabilities.forEach((cap) => params.push(cap));

      sql += `
        AND EXISTS (
          SELECT 1
          FROM jsonb_each(a.capabilities) AS cap(key, value)
          WHERE jsonb_typeof(value) = 'array'
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(value) AS elem
              WHERE elem = ANY(ARRAY[${placeholders}])
            )
        )`;

      paramIndex += capabilities.length;
    }

    if (keyword) {
      sql += ` AND (
        a.name ILIKE $${paramIndex} OR
        a.description ILIKE $${paramIndex} OR
        EXISTS (
          SELECT 1 FROM "agent_metadata" am
          WHERE am."agentId" = a.id
            AND am.visibility = 'PUBLIC'
            AND am.value ILIKE $${paramIndex}
        )
      )`;
      params.push(`%${keyword}%`);
      paramIndex++;
    }

    sql += `
      )
      SELECT
        a.id, a."didIdentifier", a.did, a.name, a.description, a.capabilities,
        a."connectionString", a.status, a."createdAt", a."updatedAt", a."ownerId",
        a."mqttUri", a."inboxTopic", a."httpWebhookUrl",
        (
          SELECT jsonb_agg(json_build_object(
            'id', am.id, 'agentId', am."agentId", 'key', am.key, 'value', am.value,
            'visibility', am.visibility, 'createdAt', am."createdAt", 'updatedAt', am."updatedAt"
          ))
          FROM "agent_metadata" am
          WHERE am."agentId" = a.id AND am.visibility = 'PUBLIC'
        ) AS metadata
      FROM matching_agents a
      ORDER BY a."createdAt" DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(limit, offset);

    console.log('[Capability Search] Executing query with params:', {
      keyword,
      capabilities,
      status,
      limit,
      offset,
    });

    const data = await this.prisma.$queryRawUnsafe<any[]>(sql, ...params);
    const formattedData = data.map((item) => ({
      ...item,
      metadata: item.metadata || [],
    }));

    console.log('[Capability Search] Found', formattedData.length, 'results');

    // Build count query - rebuild from scratch with same conditions
    let countSql = `
      WITH matching_agents AS (
        SELECT a.id
        FROM "agents" AS a
        WHERE 1=1
    `;

    let countParamIndex = 1;

    // Add same filters as main query
    if (status) {
      countSql += ` AND a.status = $${countParamIndex}::"AgentStatus"`;
      countParamIndex++;
    }

    if (capabilities && capabilities.length > 0) {
      const placeholders = capabilities
        .map((_, i) => `$${countParamIndex + i}`)
        .join(', ');
      countSql += `
        AND EXISTS (
          SELECT 1
          FROM jsonb_each(a.capabilities) AS cap(key, value)
          WHERE jsonb_typeof(value) = 'array'
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(value) AS elem
              WHERE elem = ANY(ARRAY[${placeholders}])
            )
        )`;
      countParamIndex += capabilities.length;
    }

    if (keyword) {
      countSql += ` AND (
        a.name ILIKE $${countParamIndex} OR
        a.description ILIKE $${countParamIndex} OR
        EXISTS (
          SELECT 1 FROM "agent_metadata" am
          WHERE am."agentId" = a.id
            AND am.visibility = 'PUBLIC'
            AND am.value ILIKE $${countParamIndex}
        )
      )`;
    }

    countSql += `
      )
      SELECT COUNT(*) AS count FROM matching_agents
    `;

    // Execute count query with same params (excluding limit/offset)
    const countResult = await this.prisma.$queryRawUnsafe<[{ count: bigint }]>(
      countSql,
      ...params.slice(0, -2),
    );
    const total = Number(countResult[0]?.count || 0);

    console.log('[Capability Search] Total matching agents:', total);

    return { data: formattedData, count: formattedData.length, total };
  }
}
