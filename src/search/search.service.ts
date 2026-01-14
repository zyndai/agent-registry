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
  ) {}

  /**
   * Intelligent search router - chooses best strategy based on query
   */
  async searchAgents(query: SearchQueryDto): Promise<{
    data: Agent[];
    count: number;
    total: number;
  }> {
    const { keyword, capabilities } = query;

    // Count words in keyword
    const keywordWordCount = keyword ? keyword.trim().split(/\s+/).length : 0;

    // STRATEGY 1: Single word search without capabilities -> Use keyword-only search
    // This ensures "dance" only matches agents with "dance" in name/description/capabilities
    if (keywordWordCount === 1 && (!capabilities || capabilities.length === 0)) {
      console.log('[Search Strategy] Using keyword-only search for single word');
      return this.searchByKeyword(
        keyword,
        query.status,
        query.limit,
        query.offset
      );
    }

    // STRATEGY 2: Only capabilities provided -> Use capability search
    if (!keyword && capabilities && capabilities.length > 0) {
      console.log('[Search Strategy] Using capability-only search');
      return this.searchWithCapabilities(
        keyword,
        capabilities,
        query.status,
        query.limit,
        query.offset
      );
    }

    // STRATEGY 3: Multi-word query or keyword + capabilities -> Use hybrid search
    // Examples: "dance steps", "choreograph dance", "dance" + capabilities=["entertainment"]
    if ((keywordWordCount >= 2) || (keyword && capabilities && capabilities.length > 0)) {
      console.log('[Search Strategy] Using hybrid search for complex query');
      return this.hybridSearch(query);
    }

    // STRATEGY 4: Fallback to keyword search
    console.log('[Search Strategy] Fallback to keyword search');
    return this.searchByKeyword(
      keyword,
      query.status,
      query.limit,
      query.offset
    );
  }

  /**
   * Hybrid search: Combines semantic + keyword results with deduplication
   * Best for natural language queries
   */
  private async hybridSearch(query: SearchQueryDto): Promise<{
    data: Agent[];
    count: number;
    total: number;
  }> {
    const { keyword, capabilities, status, limit = 10, offset = 0 } = query;

    try {
      // Build search text
      const searchText = [keyword, ...(capabilities || [])]
        .filter(Boolean)
        .join(' ');

      // Generate embedding
      const queryEmbedding = await this.embeddingsService.generateEmbedding(searchText);

      // Single optimized SQL query that searches everything
      let sql = `
        WITH semantic_matches AS (
          SELECT
            a.*,
            (1 - (a.embedding <=> $1::vector)) AS similarity_score
          FROM "agents" AS a
          WHERE a.embedding IS NOT NULL
            AND (1 - (a.embedding <=> $1::vector)) > 0.6
      `;

      const params: any[] = [JSON.stringify(queryEmbedding)];
      let paramIndex = 2;

      // Status filter
      if (status) {
        sql += ` AND a.status = $${paramIndex}::"AgentStatus"`;
        params.push(status);
        paramIndex++;
      }

      // Capability filter (fuzzy match)
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

      sql += `
        ),
        keyword_matches AS (
          SELECT
            a.*,
            0.3 AS similarity_score
          FROM "agents" AS a
          WHERE 1=1
      `;

      // Add status filter for keyword matches
      if (status) {
        sql += ` AND a.status = $2::"AgentStatus"`;
      }

      // Keyword search across name, description, capabilities
      if (keyword) {
        sql += ` AND (
          a.name ILIKE $${paramIndex}
          OR a.description ILIKE $${paramIndex}
          OR EXISTS (
            SELECT 1
            FROM jsonb_each(a.capabilities) AS cap(key, value)
            WHERE jsonb_typeof(value) = 'array'
              AND EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(value) AS elem
                WHERE elem ILIKE $${paramIndex}
              )
          )
          OR EXISTS (
            SELECT 1
            FROM "agent_metadata" am
            WHERE am."agentId" = a.id
              AND am.visibility = 'PUBLIC'
              AND am.value ILIKE $${paramIndex}
          )
        )`;
        params.push(`%${keyword}%`);
        paramIndex++;
      }

      // Capability filter for keyword matches
      if (capabilities && capabilities.length > 0 && !keyword) {
        const keywordCapStart = paramIndex;
        const capConditions = capabilities.map((_, i) => {
          const paramIdx = keywordCapStart + i;
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
      }

      // Use ROW_NUMBER() for deduplication instead of DISTINCT ON
      sql += `
        ),
        combined_results AS (
          SELECT * FROM semantic_matches
          UNION ALL
          SELECT * FROM keyword_matches
        ),
        ranked_results AS (
          SELECT
            *,
            ROW_NUMBER() OVER (
              PARTITION BY id 
              ORDER BY similarity_score DESC
            ) AS rn
          FROM combined_results
        )
        SELECT
          id, "didIdentifier", did, name, description, capabilities,
          "connectionString", status, "createdAt", "updatedAt", "ownerId",
          seed, "mqttUri", "inboxTopic", "httpWebhookUrl", similarity_score
        FROM ranked_results
        WHERE rn = 1
        ORDER BY similarity_score DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;

      params.push(limit, offset);

      // Execute main query
      const data = await this.prisma.$queryRawUnsafe<any[]>(sql, ...params);

      // Simplified count query
      const countSql = `
        WITH semantic_matches AS (
          SELECT a.id
          FROM "agents" AS a
          WHERE a.embedding IS NOT NULL
            AND (1 - (a.embedding <=> $1::vector)) > 0.6
            ${status ? `AND a.status = $2::"AgentStatus"` : ''}
        ),
        keyword_matches AS (
          SELECT a.id
          FROM "agents" AS a
          WHERE 1=1
            ${status ? `AND a.status = $2::"AgentStatus"` : ''}
            ${keyword ? `AND (
              a.name ILIKE $${(capabilities?.length || 0) + (status ? 3 : 2)}
              OR a.description ILIKE $${(capabilities?.length || 0) + (status ? 3 : 2)}
            )` : ''}
        ),
        combined_results AS (
          SELECT id FROM semantic_matches
          UNION
          SELECT id FROM keyword_matches
        )
        SELECT COUNT(*) as count FROM combined_results
      `;

      const countResult = await this.prisma.$queryRawUnsafe<[{ count: bigint }]>(
        countSql,
        ...params.slice(0, -2)
      );

      const total = Number(countResult[0]?.count || 0);

      return { data, count: data.length, total };

    } catch (error) {
      console.error('[Hybrid Search] Error:', error);
      // Fallback to keyword search on error
      return this.searchByKeyword(keyword, status, limit, offset);
    }
  }

  /**
   * Keyword-only search using raw SQL
   * Searches name, description, capabilities JSON, and public metadata
   */
  private async searchByKeyword(
    keyword?: string,
    status?: string,
    limit = 10,
    offset = 0,
  ): Promise<{ data: any; count: number; total: number }> {
    // If no keyword and no status filter, return all agents
    if (!keyword && !status) {
      const [data, total] = await Promise.all([
        this.prisma.agent.findMany({
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
            seed: true,
            metadata: { where: { visibility: 'PUBLIC' } },
            owner: true,
          },
        }),
        this.prisma.agent.count(),
      ]);

      return { data, count: data.length, total };
    }

    // Use raw SQL for better capability search
    let sql = `
      SELECT
        a.id, a."didIdentifier", a.did, a.name, a.description, a.capabilities,
        a."connectionString", a.status, a."createdAt", a."updatedAt", a."ownerId",
        a.seed, a."mqttUri", a."inboxTopic", a."httpWebhookUrl"
      FROM "agents" AS a
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    // Status filter
    if (status) {
      sql += ` AND a.status = $${paramIndex}::"AgentStatus"`;
      params.push(status);
      paramIndex++;
    }

    // Keyword filter - search in name, description, and capabilities JSON
    if (keyword) {
      sql += ` AND (
        a.name ILIKE $${paramIndex}
        OR a.description ILIKE $${paramIndex}
        OR EXISTS (
          SELECT 1
          FROM jsonb_each(a.capabilities) AS cap(key, value)
          WHERE jsonb_typeof(value) = 'array'
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(value) AS elem
              WHERE elem ILIKE $${paramIndex}
            )
        )
        OR EXISTS (
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
      ORDER BY a."createdAt" DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(limit, offset);

    const data = await this.prisma.$queryRawUnsafe<any[]>(sql, ...params);

    // Count query
    let countSql = `
      SELECT COUNT(*) as count
      FROM "agents" AS a
      WHERE 1=1
    `;

    let countParamIndex = 1;

    if (status) {
      countSql += ` AND a.status = $${countParamIndex}::"AgentStatus"`;
      countParamIndex++;
    }

    if (keyword) {
      countSql += ` AND (
        a.name ILIKE $${countParamIndex}
        OR a.description ILIKE $${countParamIndex}
        OR EXISTS (
          SELECT 1
          FROM jsonb_each(a.capabilities) AS cap(key, value)
          WHERE jsonb_typeof(value) = 'array'
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(value) AS elem
              WHERE elem ILIKE $${countParamIndex}
            )
        )
        OR EXISTS (
          SELECT 1 FROM "agent_metadata" am
          WHERE am."agentId" = a.id
            AND am.visibility = 'PUBLIC'
            AND am.value ILIKE $${countParamIndex}
        )
      )`;
    }

    const countResult = await this.prisma.$queryRawUnsafe<[{ count: bigint }]>(
      countSql,
      ...params.slice(0, -2)
    );

    const total = Number(countResult[0]?.count || 0);

    return { data, count: data.length, total };
  }

  /**
   * Capability-focused search with optional keyword
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

    // Fuzzy capability search across all categories
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

    if (keyword) {
      sql += ` AND (
        a.name ILIKE $${paramIndex}
        OR a.description ILIKE $${paramIndex}
        OR EXISTS (
          SELECT 1
          FROM jsonb_each(a.capabilities) AS cap(key, value)
          WHERE jsonb_typeof(value) = 'array'
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(value) AS elem
              WHERE elem ILIKE $${paramIndex}
            )
        )
        OR EXISTS (
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
        a.seed, a."mqttUri", a."inboxTopic", a."httpWebhookUrl",
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

    const data = await this.prisma.$queryRawUnsafe<any[]>(sql, ...params);
    const formattedData = data.map((item) => ({
      ...item,
      metadata: item.metadata || [],
    }));

    // Count query
    let countSql = `
      SELECT COUNT(*) AS count
      FROM "agents" AS a
      WHERE 1=1
    `;

    let countParamIndex = 1;

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

    if (keyword) {
      countSql += ` AND (
        a.name ILIKE $${countParamIndex}
        OR a.description ILIKE $${countParamIndex}
        OR EXISTS (
          SELECT 1
          FROM jsonb_each(a.capabilities) AS cap(key, value)
          WHERE jsonb_typeof(value) = 'array'
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(value) AS elem
              WHERE elem ILIKE $${countParamIndex}
            )
        )
        OR EXISTS (
          SELECT 1 FROM "agent_metadata" am
          WHERE am."agentId" = a.id
            AND am.visibility = 'PUBLIC'
            AND am.value ILIKE $${countParamIndex}
        )
      )`;
    }

    const countResult = await this.prisma.$queryRawUnsafe<[{ count: bigint }]>(
      countSql,
      ...params.slice(0, -2),
    );
    const total = Number(countResult[0]?.count || 0);

    return { data: formattedData, count: formattedData.length, total };
  }
}