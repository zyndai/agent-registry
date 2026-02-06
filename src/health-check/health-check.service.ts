import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from 'src/prisma/prisma.service';
import { AgentStatus } from '@prisma/client';

const BATCH_SIZE = 20;
const HEALTH_CHECK_TIMEOUT_MS = 5000;

@Injectable()
export class HealthCheckService {
  private readonly logger = new Logger(HealthCheckService.name);
  private isRunning = false;

  constructor(private prismaService: PrismaService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleHealthChecks() {
    if (this.isRunning) {
      this.logger.warn('Health check already in progress, skipping');
      return;
    }

    this.isRunning = true;
    this.logger.log('Starting agent health checks...');

    try {
      // Step 1: Mark agents without webhook URL as INACTIVE
      const agentsWithoutUrl = await this.prismaService.agent.updateMany({
        where: {
          httpWebhookUrl: null,
          status: { not: AgentStatus.DEPRECATED },
        },
        data: {
          status: AgentStatus.INACTIVE,
          lastHealthCheckAt: new Date(),
        },
      });

      if (agentsWithoutUrl.count > 0) {
        this.logger.log(
          `Marked ${agentsWithoutUrl.count} agents without webhook URL as INACTIVE`,
        );
      }

      // Step 2: Check agents with webhook URL
      const agents = await this.prismaService.agent.findMany({
        where: {
          httpWebhookUrl: { not: null },
          status: { not: AgentStatus.DEPRECATED },
        },
        select: {
          id: true,
          httpWebhookUrl: true,
          status: true,
        },
      });

      this.logger.log(`Found ${agents.length} agents with webhook URLs to check`);

      for (let i = 0; i < agents.length; i += BATCH_SIZE) {
        const batch = agents.slice(i, i + BATCH_SIZE);
        this.logger.log(
          `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(agents.length / BATCH_SIZE)} (${batch.length} agents)`,
        );

        const results = await Promise.allSettled(
          batch.map((agent) => this.checkAgent(agent)),
        );

        const updates: { id: string; isHealthy: boolean }[] = [];

        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          const agent = batch[j];

          if (result.status === 'fulfilled') {
            updates.push({ id: agent.id, isHealthy: result.value });
          } else {
            updates.push({ id: agent.id, isHealthy: false });
          }
        }

        await this.batchUpdateStatus(updates);
      }

      this.logger.log('Health checks completed');
    } catch (error) {
      this.logger.error('Health check cycle failed', error);
    } finally {
      this.isRunning = false;
    }
  }

  private async checkAgent(agent: {
    id: string;
    httpWebhookUrl: string | null;
  }): Promise<boolean> {
    if (!agent.httpWebhookUrl) return false;

    try {
      const healthUrl = this.deriveHealthUrl(agent.httpWebhookUrl);

      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        HEALTH_CHECK_TIMEOUT_MS,
      );

      try {
        const response = await fetch(healthUrl, {
          method: 'GET',
          signal: controller.signal,
        });

        clearTimeout(timeout);
        return response.ok;
      } catch {
        clearTimeout(timeout);
        return false;
      }
    } catch {
      return false;
    }
  }

  private deriveHealthUrl(webhookUrl: string): string {
    try {
      const url = new URL(webhookUrl);
      url.pathname = '/health';
      return url.toString();
    } catch {
      return webhookUrl;
    }
  }

  private async batchUpdateStatus(
    updates: { id: string; isHealthy: boolean }[],
  ) {
    const now = new Date();

    const activeIds = updates
      .filter((u) => u.isHealthy)
      .map((u) => u.id);
    const inactiveIds = updates
      .filter((u) => !u.isHealthy)
      .map((u) => u.id);

    const ops: Promise<any>[] = [];

    if (activeIds.length > 0) {
      ops.push(
        this.prismaService.agent.updateMany({
          where: { id: { in: activeIds } },
          data: {
            status: AgentStatus.ACTIVE,
            lastHealthCheckAt: now,
          },
        }),
      );
      this.logger.log(`Marking ${activeIds.length} agents as ACTIVE`);
    }

    if (inactiveIds.length > 0) {
      ops.push(
        this.prismaService.agent.updateMany({
          where: { id: { in: inactiveIds } },
          data: {
            status: AgentStatus.INACTIVE,
            lastHealthCheckAt: now,
          },
        }),
      );
      this.logger.log(`Marking ${inactiveIds.length} agents as INACTIVE`);
    }

    await Promise.all(ops);
  }
}
