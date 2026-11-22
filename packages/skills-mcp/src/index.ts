import fs from 'node:fs/promises';
import path from 'node:path';
import {
  discoverAndMergeRegistry,
  loadRegistry,
  resolveHostPaths,
  type SkillItem,
} from '@harness-hub/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export interface SkillProvider {
  getSkills(): Promise<SkillItem[]>;
}

export function createDefaultSkillProvider(options?: {
  homeDir?: string;
  registryPath?: string;
}): SkillProvider {
  const paths = resolveHostPaths({ homeDir: options?.homeDir });
  const registryPath = options?.registryPath ?? paths.registryPath;

  return {
    async getSkills(): Promise<SkillItem[]> {
      const reg = await loadRegistry(registryPath, paths);
      if (reg.skills.length > 0) {
        return reg.skills;
      }
      const discovered = await discoverAndMergeRegistry(paths, reg);
      return discovered.skills;
    },
  };
}

export function filterAndRankSkills(
  skills: SkillItem[],
  query: string,
  limit = 15
): SkillItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return skills.slice(0, limit);

  const terms = q.split(/\s+/).filter(Boolean);
  const scored: Array<{ skill: SkillItem; score: number }> = [];

  for (const skill of skills) {
    const idLower = skill.id.toLowerCase();
    const nameLower = skill.name.toLowerCase();
    const descLower = skill.description.toLowerCase();
    const tagsLower = skill.tags.join(' ').toLowerCase();
    const catLower = skill.category.toLowerCase();

    let score = 0;
    if (idLower === q || nameLower === q) score += 100;
    else if (idLower.includes(q) || nameLower.includes(q)) score += 40;

    for (const term of terms) {
      if (idLower.includes(term)) score += 15;
      if (nameLower.includes(term)) score += 12;
      if (catLower.includes(term) || tagsLower.includes(term)) score += 8;
      if (descLower.includes(term)) score += 4;
    }

    if (score > 0) {
      scored.push({ skill, score });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id))
    .slice(0, limit)
    .map((s) => s.skill);
}

export async function readSkillContent(
  skills: SkillItem[],
  skillId: string
): Promise<{
  skill: SkillItem;
  markdown: string;
  attachmentPaths: string[];
}> {
  const skill = skills.find(
    (s) => s.id === skillId || s.name.toLowerCase() === skillId.toLowerCase()
  );
  if (!skill) {
    throw new Error(`Skill '${skillId}' not found in HarnessHub catalog.`);
  }
  const skillMdPath = path.join(skill.canonicalPath, 'SKILL.md');
  const markdown = await fs.readFile(skillMdPath, 'utf8');
  const attachmentPaths = skill.attachments.map((rel) => path.join(skill.canonicalPath, rel));
  return { skill, markdown, attachmentPaths };
}

/**
 * Create a standard MCP Server exposing `list_skills`, `search_skills`, and `read_skill`
 * over standard `tools/list` + `tools/call` (compatible with Codex, OpenCode, Hermes, Antigravity).
 */
export function createSkillsMcpServer(provider: SkillProvider): McpServer {
  const server = new McpServer({
    name: 'harness-skills',
    version: '0.1.0',
  });

  server.tool(
    'list_skills',
    'List available HarnessHub skills with optional category filtering.',
    {
      category: z.string().optional().describe('Filter skills by category name'),
      limit: z.number().int().min(1).max(200).optional().describe('Max skills to return (default 50)'),
    },
    async ({ category, limit }) => {
      const skills = await provider.getSkills();
      const filtered = category
        ? skills.filter((s) => s.category.toLowerCase() === category.toLowerCase())
        : skills;
      const sliced = filtered.slice(0, limit ?? 50).map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        description: s.description,
        tags: s.tags,
        hasAttachments: s.attachments.length > 0,
      }));
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ total: filtered.length, items: sliced }, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    'search_skills',
    'Search the deduplicated HarnessHub skill library by keyword, tag, or description.',
    {
      query: z.string().min(1).describe('Search query keywords'),
      limit: z.number().int().min(1).max(50).optional().describe('Max matches to return (default 15)'),
    },
    async ({ query, limit }) => {
      const skills = await provider.getSkills();
      const matches = filterAndRankSkills(skills, query, limit ?? 15).map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        description: s.description,
        tags: s.tags,
      }));
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ query, count: matches.length, matches }, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    'read_skill',
    'Read the full SKILL.md instructions and supporting file paths for a specific skill.',
    {
      id: z.string().min(1).describe('Skill id or exact name'),
    },
    async ({ id }) => {
      const skills = await provider.getSkills();
      const { skill, markdown, attachmentPaths } = await readSkillContent(skills, id);
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
        content: [
          {
            type: 'text',
            text: header + markdown,
          },
        ],
      };
    }
  );

  return server;
}
