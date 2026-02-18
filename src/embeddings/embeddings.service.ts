// src/embeddings/embeddings.service.ts
import { Injectable } from '@nestjs/common';
import { OpenAIEmbeddings } from '@langchain/openai';

@Injectable()
export class EmbeddingsService {
  private embeddings: OpenAIEmbeddings;

  constructor() {
    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
      modelName: 'text-embedding-3-small',
    });
  }

  async generateEmbedding(text: string): Promise<number[]> {
    return await this.embeddings.embedQuery(text);
  }

  // Generate embedding from agent data
  async generateAgentEmbedding(agent: {
    name: string;
    description?: string;
    capabilities?: any;
  }): Promise<number[]> {
    const text = this.createSearchableText(agent);
    return await this.generateEmbedding(text);
  }

  private createSearchableText(agent: {
    name: string;
    description?: string;
    capabilities?: any;
  }): string {
    const parts: string[] = [];

    // Name is most important - repeat with multiple phrasings for embedding emphasis
    // Also break apart hyphenated/camelCase names into individual words
    const nameVariations = this.expandName(agent.name);
    parts.push(
      `Agent Name: ${agent.name}. This agent is called ${agent.name}. Also known as: ${nameVariations}.`,
    );

    if (agent.description) {
      parts.push(`Description: ${agent.description}`);
    }

    console.log('Agent capabilities:', agent.capabilities);

    if (agent.capabilities) {
      // Add structured context to capabilities for better semantic understanding
      if (agent.capabilities.ai && agent.capabilities.ai.length > 0) {
        parts.push(
          `AI Capabilities: ${agent.capabilities.ai.join(', ')}. The agent can perform ${agent.capabilities.ai.join(', ')}. Skilled in ${agent.capabilities.ai.join(' and ')}.`,
        );
      }
      if (
        agent.capabilities.protocols &&
        agent.capabilities.protocols.length > 0
      ) {
        parts.push(
          `Supported Protocols: ${agent.capabilities.protocols.join(', ')}. Compatible with ${agent.capabilities.protocols.join(', ')}. Uses ${agent.capabilities.protocols.join(', ')} protocols.`,
        );
      }
      if (
        agent.capabilities.integration &&
        agent.capabilities.integration.length > 0
      ) {
        parts.push(
          `Integrations: ${agent.capabilities.integration.join(', ')}. Integrates with ${agent.capabilities.integration.join(', ')}. Works with ${agent.capabilities.integration.join(' and ')}.`,
        );
      }
    }

    const searchableText = parts.join('. ');
    console.log('Generated searchable text:', searchableText);
    return searchableText;
  }

  /**
   * Expand an agent name into multiple searchable variations.
   * e.g., "zyndmixer-medico-bot" → "zyndmixer, medico, bot, medico bot, zyndmixer medico bot"
   * e.g., "MedicoAgent" → "Medico, Agent, Medico Agent"
   */
  private expandName(name: string): string {
    const variations = new Set<string>();
    variations.add(name);

    // Split on hyphens, underscores, dots
    const hyphenParts = name.split(/[-_\.]+/);
    hyphenParts.forEach((part) => {
      if (part.length > 1) variations.add(part);
    });

    // Split camelCase / PascalCase
    const camelParts = name.replace(/([a-z])([A-Z])/g, '$1 $2').split(/\s+/);
    camelParts.forEach((part) => {
      if (part.length > 1) variations.add(part);
    });

    // Combine all individual words without prefix (skip common prefixes like "zynd", "zyndmixer")
    const allWords = name
      .split(/[-_\.\s]+/)
      .flatMap((w) => w.replace(/([a-z])([A-Z])/g, '$1 $2').split(/\s+/))
      .filter((w) => w.length > 1);
    if (allWords.length > 1) {
      variations.add(allWords.join(' '));
    }

    return Array.from(variations).join(', ');
  }
}
