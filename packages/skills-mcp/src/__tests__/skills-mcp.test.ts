import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createSkillsMcpServer,
  filterAndRankSkills,
  readSkillContent,
} from '../index.js';
import type { SkillItem } from '@harness-hub/core';

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    await fs.rm(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('skills-mcp server helpers', () => {
  it('ranks and reads skills safely without exposing arbitrary paths', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-skills-mcp-'));
    tempDirs.push(dir);

    const skillDir = path.join(dir, 'ego-browser');
    await fs.mkdir(path.join(skillDir, 'references'), { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# Ego Browser\nUse ego-browser CLI.');
    await fs.writeFile(path.join(skillDir, 'references', 'api.md'), 'API docs');

    const catalog: SkillItem[] = [
      {
        id: 'ego-browser',
        name: 'ego-browser',
        description: 'Operate Chromium browser',
        sha256: 'abc',
        canonicalPath: skillDir,
        originSource: 'agents',
        category: 'browser',
        tags: ['browser', 'qa'],
        attachments: ['references/api.md'],
        locations: [],
      },
      {
        id: 'postgres-tuning',
        name: 'postgres-tuning',
        description: 'Optimize SQL queries',
        sha256: 'def',
        canonicalPath: path.join(dir, 'postgres-tuning'),
        originSource: 'hermes',
        category: 'database',
        tags: ['sql'],
        attachments: [],
        locations: [],
      },
    ];

    const hits = filterAndRankSkills(catalog, 'browser');
    expect(hits.map((h) => h.id)).toEqual(['ego-browser']);

    const read = await readSkillContent(catalog, 'ego-browser');
    expect(read.markdown).toContain('Use ego-browser CLI');
    expect(read.attachmentPaths).toEqual([path.join(skillDir, 'references/api.md')]);

    await expect(readSkillContent(catalog, '../../etc/passwd')).rejects.toThrow();

    const server = createSkillsMcpServer({ getSkills: async () => catalog });
    const client = new Client({ name: 'skills-mcp-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    try {
      await client.connect(clientTransport);
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual(['list_skills', 'read_skill', 'search_skills']);
      for (const tool of tools) {
        expect(tool.annotations).toEqual({
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        });
      }
      await expect(client.callTool({ name: 'list_skills', arguments: { category: 'browser' } }))
        .resolves.toMatchObject({ content: [{ type: 'text', text: expect.stringContaining('ego-browser') }] });
      await expect(client.callTool({ name: 'search_skills', arguments: { query: 'browser' } }))
        .resolves.toMatchObject({ content: [{ type: 'text', text: expect.stringContaining('ego-browser') }] });
      await expect(client.callTool({ name: 'read_skill', arguments: { id: 'ego-browser' } }))
        .resolves.toMatchObject({ content: [{ type: 'text', text: expect.stringContaining('Use ego-browser CLI') }] });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
