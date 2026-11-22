#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDefaultSkillProvider, createSkillsMcpServer } from './index.js';

async function main() {
  const provider = createDefaultSkillProvider({
    homeDir: process.env.HARNESS_HUB_HOME,
    registryPath: process.env.HARNESS_HUB_REGISTRY,
  });
  const server = createSkillsMcpServer(provider);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('harness-skills-mcp fatal error:', err);
  process.exit(1);
});
