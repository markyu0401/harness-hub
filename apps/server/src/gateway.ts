import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  resolveHermesOAuthHeader,
  resolveRuntimeSecrets,
  type HarnessId,
  type McpHarnessAllocation,
  type McpServerItem,
  type RegistryFile,
} from '@harness-hub/core';
import { filterAndRankSkills, readSkillContent } from '@harness-hub/skills-mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

const TOOL_DELIMITER = '__';

const BUILTIN_SKILL_TOOLS: Tool[] = [
  {
    name: 'list_skills',
    description:
      'List all deduplicated skills available in the HarnessHub library with optional category filtering.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Optional category name filter' },
        limit: { type: 'number', description: 'Max skills to return (default 50)' },
      },
    },
  },
  {
    name: 'search_skills',
    description:
      'Search the full HarnessHub skill library by keyword, tag, or description without bloating startup context.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keywords' },
        limit: { type: 'number', description: 'Max matches to return (default 15)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_skill',
    description: 'Read the full SKILL.md instructions and supporting attachment paths for a skill.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill id or exact name' },
      },
      required: ['id'],
    },
  },
];

interface CachedUpstream {
  signature: string;
  client: Client;
  tools: Tool[];
}

function isToolAllowed(toolName: string, alloc: McpHarnessAllocation, item: McpServerItem): boolean {
  const allow = alloc.enabledTools ?? item.defaultEnabledTools;
  const deny = alloc.disabledTools ?? item.defaultDisabledTools;
  if (allow && allow.length > 0 && !allow.includes(toolName)) {
    return false;
  }
  if (deny && deny.length > 0 && deny.includes(toolName)) {
    return false;
  }
  return true;
}

export class McpGatewayManager {
  private upstreams = new Map<string, CachedUpstream>();

  constructor(private readonly homeDir?: string) {}

  private buildSignature(item: McpServerItem, authSignature = ''): string {
    return JSON.stringify({
      transport: item.transport,
      command: item.command,
      args: item.args,
      url: item.url,
      headers: item.headers,
      env: item.env,
      authSignature,
    });
  }

  private async getUpstreamClient(item: McpServerItem): Promise<CachedUpstream> {
    let headers: Record<string, string> = {};
    let authSignature = '';
    if (item.url) {
      headers = await resolveRuntimeSecrets(item.headers);
      if (!headers.Authorization && !headers.authorization) {
        const oauthHeader = await resolveHermesOAuthHeader(item.id, { homeDir: this.homeDir });
        if (oauthHeader) {
          headers = { ...headers, ...oauthHeader };
          authSignature = `hermes-oauth:${oauthHeader.Authorization?.length ?? 0}:${oauthHeader.Authorization?.slice(-8) ?? ''}`;
        }
      }
    }

    const signature = this.buildSignature(item, authSignature);
    const cached = this.upstreams.get(item.id);
    if (cached && cached.signature === signature) {
      return cached;
    }

    if (cached) {
      await cached.client.close().catch(() => {});
      this.upstreams.delete(item.id);
    }

    const client = new Client({
      name: 'harness-hub-gateway',
      version: '0.1.0',
    });

    if (item.url) {
      const url = new URL(item.url);
      if (item.transport === 'sse') {
        const transport = new SSEClientTransport(url, {
          requestInit: { headers },
        });
        await client.connect(transport);
      } else {
        const transport = new StreamableHTTPClientTransport(url, {
          requestInit: { headers },
        });
        await client.connect(transport);
      }
    } else if (item.command) {
      const resolvedEnv = await resolveRuntimeSecrets(item.env);
      const mergedEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined) mergedEnv[k] = v;
      }
      Object.assign(mergedEnv, resolvedEnv);

      const transport = new StdioClientTransport({
        command: item.command,
        args: item.args ?? [],
        env: mergedEnv,
      });
      await client.connect(transport);
    } else {
      throw new Error(`MCP server '${item.id}' has neither url nor command.`);
    }

    const listed = await client.listTools();
    const entry: CachedUpstream = {
      signature,
      client,
      tools: listed.tools ?? [],
    };
    this.upstreams.set(item.id, entry);
    return entry;
  }

  async listToolsForHarness(registry: RegistryFile, harnessId: HarnessId): Promise<Tool[]> {
    const tools: Tool[] = [];
    const settings = registry.harnesses[harnessId];
    if (settings?.exposeSkillsMcp !== false) {
      tools.push(...BUILTIN_SKILL_TOOLS);
    }

    for (const item of registry.mcps) {
      const alloc = registry.allocations.mcps[item.id]?.[harnessId];
      if (!alloc || !alloc.enabled || alloc.mode !== 'gateway') continue;
      try {
        const upstream = await this.getUpstreamClient(item);
        for (const tool of upstream.tools) {
          if (!isToolAllowed(tool.name, alloc, item)) continue;
          tools.push({
            ...tool,
            name: `${item.id}${TOOL_DELIMITER}${tool.name}`,
            description: `[${item.id}] ${tool.description ?? ''}`.trim(),
          });
        }
      } catch {
        // Keep other upstreams & skill tools operational even if one upstream fails.
      }
    }

    return tools;
  }

  async callToolForHarness(
    registry: RegistryFile,
    harnessId: HarnessId,
    name: string,
    args: Record<string, unknown> = {}
  ) {
    if (name === 'list_skills') {
      const category = typeof args.category === 'string' ? args.category : undefined;
      const limit = typeof args.limit === 'number' ? args.limit : 50;
      const filtered = category
        ? registry.skills.filter((s) => s.category.toLowerCase() === category.toLowerCase())
        : registry.skills;
      const items = filtered.slice(0, limit).map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        description: s.description,
        tags: s.tags,
        hasAttachments: s.attachments.length > 0,
      }));
      return {
        content: [{ type: 'text', text: JSON.stringify({ total: filtered.length, items }, null, 2) }],
      };
    }

    if (name === 'search_skills') {
      const query = typeof args.query === 'string' ? args.query : '';
      const limit = typeof args.limit === 'number' ? args.limit : 15;
      const matches = filterAndRankSkills(registry.skills, query, limit).map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        description: s.description,
        tags: s.tags,
      }));
      return {
        content: [
          { type: 'text', text: JSON.stringify({ query, count: matches.length, matches }, null, 2) },
        ],
      };
    }

    if (name === 'read_skill') {
      const id = typeof args.id === 'string' ? args.id : '';
      const { skill, markdown, attachmentPaths } = await readSkillContent(registry.skills, id);
      const header = [
        `# Skill: ${skill.name} (${skill.id})`,
        `Canonical Path: ${skill.canonicalPath}`,
        attachmentPaths.length > 0
          ? `Supporting Files:\n${attachmentPaths.map((p) => `- ${p}`).join('\n')}`
          : 'Supporting Files: none',
        '---',
        '',
      ].join('\n');
      return {
        content: [{ type: 'text', text: header + markdown }],
      };
    }

    const sepIdx = name.indexOf(TOOL_DELIMITER);
    if (sepIdx === -1) {
      throw new Error(`Unknown tool '${name}'`);
    }
    const mcpId = name.slice(0, sepIdx);
    const remoteToolName = name.slice(sepIdx + TOOL_DELIMITER.length);

    const item = registry.mcps.find((m) => m.id === mcpId);
    const alloc = registry.allocations.mcps[mcpId]?.[harnessId];
    if (!item || !alloc || !alloc.enabled || alloc.mode !== 'gateway') {
      throw new Error(`MCP server '${mcpId}' is not enabled in gateway mode for '${harnessId}'.`);
    }
    if (!isToolAllowed(remoteToolName, alloc, item)) {
      throw new Error(`Tool '${remoteToolName}' is disabled for '${harnessId}'.`);
    }

    const upstream = await this.getUpstreamClient(item);
    return upstream.client.callTool({
      name: remoteToolName,
      arguments: args,
    });
  }

  async handleHttpRequest(
    getRegistry: () => RegistryFile,
    harnessId: HarnessId,
    req: IncomingMessage,
    res: ServerResponse,
    parsedBody?: unknown
  ): Promise<void> {
    const server = new Server(
      {
        name: `harness-hub-${harnessId}`,
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = await this.listToolsForHarness(getRegistry(), harnessId);
      return { tools };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name;
      const args = (request.params.arguments ?? {}) as Record<string, unknown>;
      return this.callToolForHarness(getRegistry(), harnessId, toolName, args);
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);
    try {
      await transport.handleRequest(req, res, parsedBody);
    } finally {
      await server.close().catch(() => {});
    }
  }

  async closeAll(): Promise<void> {
    const closers = Array.from(this.upstreams.values()).map((u) =>
      u.client.close().catch(() => {})
    );
    this.upstreams.clear();
    await Promise.all(closers);
  }
}
