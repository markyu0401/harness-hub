import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import type {
  DiscoverySourceId,
  HostPaths,
  SkillConflict,
  SkillConflictVariant,
  SkillItem,
  SkillLocation,
  SkillPortability,
} from '../types.js';
import { analyzeSkillPortability } from './skill-lint.js';

const SOURCE_PRIORITY: Record<string, number> = {
  agents: 0,
  hermes: 1,
  opencode: 2,
  codex: 3,
  antigravity: 4,
  claude: 5,
  gemini: 6,
};

interface ParsedSkillFrontmatter {
  name?: string;
  description?: string;
  category?: string;
  tags?: string[];
}

export interface DiscoveredSkillCandidate {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  source: DiscoverySourceId;
  path: string;
  realPath: string;
  isSymlink: boolean;
  sha256: string;
  attachments: string[];
  fileCount: number;
  portability: SkillPortability;
}

export function slugifySkillName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unnamed-skill';
}

export function parseSkillFrontmatter(markdown: string): {
  meta: ParsedSkillFrontmatter;
  body: string;
} {
  const normalized = markdown.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { meta: {}, body: normalized };
  }
  const endIdx = normalized.indexOf('\n---\n', 4);
  if (endIdx === -1) {
    return { meta: {}, body: normalized };
  }
  const yamlBlock = normalized.slice(4, endIdx);
  const body = normalized.slice(endIdx + 5);
  try {
    const parsed = YAML.parse(yamlBlock);
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      const metadata =
        obj.metadata && typeof obj.metadata === 'object'
          ? (obj.metadata as Record<string, unknown>)
          : undefined;
      const hermesMeta =
        metadata?.hermes && typeof metadata.hermes === 'object'
          ? (metadata.hermes as Record<string, unknown>)
          : undefined;

      const category =
        (typeof obj.category === 'string' ? obj.category : undefined) ??
        (typeof metadata?.category === 'string' ? metadata.category : undefined) ??
        (typeof hermesMeta?.category === 'string' ? hermesMeta.category : undefined);

      const rawTags = Array.isArray(obj.tags)
        ? obj.tags
        : Array.isArray(metadata?.tags)
          ? metadata.tags
          : Array.isArray(hermesMeta?.tags)
            ? hermesMeta.tags
            : undefined;

      return {
        meta: {
          name: typeof obj.name === 'string' ? obj.name : undefined,
          description: typeof obj.description === 'string' ? obj.description : undefined,
          category,
          tags: rawTags?.filter((t): t is string => typeof t === 'string'),
        },
        body,
      };
    }
  } catch {
    // Fallback gracefully on malformed frontmatter.
  }
  return { meta: {}, body: normalized };
}

const CATEGORY_RULES: Array<{ category: string; pattern: RegExp }> = [
  {
    category: 'browser',
    pattern: /\b(browser|playwright|puppeteer|chromium|scrape|scraping|crawl|webpage|web-fetch|ego-browser|agent-browser|agent-reach)\b/i,
  },
  {
    category: 'documents',
    pattern: /\b(pdf|docx|xlsx|pptx|word|excel|spreadsheet|slides|latex|academic|paper|writing|prose|humanizer|markdown|csv)\b/i,
  },
  {
    category: 'apple',
    pattern: /\b(ios|macos|xcode|swift|simctl|simulator|apple|ipad|iphone)\b/i,
  },
  {
    category: 'media',
    pattern: /\b(image|video|audio|speech|tts|whisper|ffmpeg|diagram|chart|ui-ux|design|figma|mermaid|canvas)\b/i,
  },
  {
    category: 'devops',
    pattern: /\b(docker|kubernetes|k8s|deploy|ssh|linux|systemd|launchd|cloud|aws|ci\/cd|observability|tracing|telemetry|server|network|security)\b/i,
  },
  {
    category: 'research',
    pattern: /\b(research|arxiv|hindsight|memory|search|rag|wiki|literature|citation)\b/i,
  },
  {
    category: 'productivity',
    pattern: /\b(email|gmail|calendar|note|obsidian|notion|todo|schedule|brainstorm|meeting|workflow|plan)\b/i,
  },
  {
    category: 'coding',
    pattern: /\b(code|coding|git|github|pull request|review|debug|test|vitest|pytest|typescript|python|rust|react|api|cli|mcp|skill|agent|subagent|refactor|build)\b/i,
  },
];

export function inferSkillCategory(options: {
  explicitCategory?: string;
  relParent?: string;
  id: string;
  name: string;
  description: string;
  tags: string[];
}): string {
  const fromMeta = options.explicitCategory?.trim().toLowerCase();
  if (fromMeta && fromMeta !== 'general') return fromMeta;

  const fromFolder =
    options.relParent && options.relParent !== '.'
      ? options.relParent.split(path.sep)[0]?.trim().toLowerCase()
      : undefined;
  if (fromFolder && fromFolder !== 'general') return fromFolder;

  const haystack = `${options.id} ${options.name} ${options.tags.join(' ')} ${options.description}`;
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(haystack)) {
      return rule.category;
    }
  }
  return 'general';
}

async function collectRelativeFiles(rootDir: string, relPrefix = ''): Promise<string[]> {
  const currentDir = relPrefix ? path.join(rootDir, relPrefix) : rootDir;
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__pycache__') {
      continue;
    }
    const relPath = relPrefix ? path.posix.join(relPrefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      const nested = await collectRelativeFiles(rootDir, relPath);
      files.push(...nested);
    } else if (entry.isFile()) {
      files.push(relPath);
    }
  }

  return files.sort();
}

export async function computeSkillFingerprint(skillRealDir: string): Promise<{
  sha256: string;
  attachments: string[];
  fileCount: number;
}> {
  const files = await collectRelativeFiles(skillRealDir);
  const hash = crypto.createHash('sha256');

  for (const relFile of files) {
    const absFile = path.join(skillRealDir, relFile);
    const content = await fs.readFile(absFile);
    hash.update(relFile);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }

  const attachments = files.filter((f) => f !== 'SKILL.md');
  return {
    sha256: hash.digest('hex'),
    attachments,
    fileCount: files.length,
  };
}

async function existsDirOrSymlinkTarget(targetPath: string): Promise<{
  exists: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  realPath: string;
}> {
  try {
    const lstat = await fs.lstat(targetPath);
    const isSymlink = lstat.isSymbolicLink();
    const realPath = await fs.realpath(targetPath);
    const stat = await fs.stat(realPath);
    return {
      exists: true,
      isDirectory: stat.isDirectory(),
      isSymlink,
      realPath,
    };
  } catch {
    return {
      exists: false,
      isDirectory: false,
      isSymlink: false,
      realPath: targetPath,
    };
  }
}

async function walkSkillDirectory(
  rootDir: string,
  currentDir: string,
  source: DiscoverySourceId,
  inheritedSymlink: boolean,
  depth: number,
  out: DiscoveredSkillCandidate[]
): Promise<void> {
  if (depth > 3) return;

  let entries;
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const candidatePath = path.join(currentDir, entry.name);
    const info = await existsDirOrSymlinkTarget(candidatePath);
    if (!info.exists || !info.isDirectory) continue;

    const isSymlink = inheritedSymlink || info.isSymlink;
    const skillMdPath = path.join(info.realPath, 'SKILL.md');
    let skillMdContent: string | undefined;
    try {
      skillMdContent = await fs.readFile(skillMdPath, 'utf8');
    } catch {
      skillMdContent = undefined;
    }

    if (skillMdContent !== undefined) {
      const { meta, body } = parseSkillFrontmatter(skillMdContent);
      const { sha256, attachments, fileCount } = await computeSkillFingerprint(info.realPath);
      const portability = analyzeSkillPortability({
        hasName: Boolean(meta.name?.trim()),
        hasDescription: Boolean(meta.description?.trim()),
        body,
        attachments,
      });
      const relParent = path.relative(rootDir, currentDir);
      const id = slugifySkillName(entry.name);
      const name = meta.name?.trim() || entry.name;
      const description = meta.description?.trim() || '';
      const inferredCategory = inferSkillCategory({
        explicitCategory: meta.category,
        relParent,
        id,
        name,
        description,
        tags: meta.tags ?? [],
      });
      const tags = Array.from(
        new Set([...(meta.tags ?? []), ...(inferredCategory !== 'general' ? [inferredCategory] : [])])
      );

      out.push({
        id,
        name,
        description,
        category: inferredCategory,
        tags,
        source,
        path: candidatePath,
        realPath: info.realPath,
        isSymlink,
        sha256,
        attachments,
        fileCount,
        portability,
      });
      continue;
    }

    // Recurse into category folders (e.g. ~/.hermes/skills/devops/*)
    await walkSkillDirectory(rootDir, candidatePath, source, isSymlink, depth + 1, out);
  }
}

export interface SkillScanReport {
  skills: SkillItem[];
  conflicts: SkillConflict[];
  candidatesCount: number;
}

function chooseBestCandidate(
  candidates: DiscoveredSkillCandidate[],
  preferredRealPath?: string
): DiscoveredSkillCandidate {
  if (preferredRealPath) {
    const match = candidates.find((c) => c.realPath === preferredRealPath);
    if (match) return match;
  }
  return [...candidates].sort((a, b) => {
    if (a.isSymlink !== b.isSymlink) return a.isSymlink ? 1 : -1;
    const pa = SOURCE_PRIORITY[a.source] ?? 99;
    const pb = SOURCE_PRIORITY[b.source] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.path.localeCompare(b.path);
  })[0]!;
}

/**
 * Scan all configured skill directories and deduplicate by SHA-256 content hash.
 * Divergent skills sharing the same directory slug are reported in `conflicts`.
 */
export async function scanSkills(
  paths: HostPaths,
  resolvedConflicts?: Record<string, string>
): Promise<SkillScanReport> {
  const allCandidates: DiscoveredSkillCandidate[] = [];

  for (const { source, dir } of paths.skillScanDirs) {
    await walkSkillDirectory(dir, dir, source, false, 0, allCandidates);
  }

  // Group candidates by skill id
  const byId = new Map<string, DiscoveredSkillCandidate[]>();
  for (const candidate of allCandidates) {
    const group = byId.get(candidate.id) ?? [];
    group.push(candidate);
    byId.set(candidate.id, group);
  }

  const skills: SkillItem[] = [];
  const conflicts: SkillConflict[] = [];

  for (const [id, group] of Array.from(byId.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const uniqueHashes = new Map<string, DiscoveredSkillCandidate[]>();
    for (const item of group) {
      const list = uniqueHashes.get(item.sha256) ?? [];
      list.push(item);
      uniqueHashes.set(item.sha256, list);
    }

    const preferredRealPath = resolvedConflicts?.[id];
    const canonical = chooseBestCandidate(group, preferredRealPath);
    const nonGeneralCategory =
      canonical.category !== 'general'
        ? canonical.category
        : group.find((g) => g.category !== 'general')?.category ?? 'general';

    if (uniqueHashes.size > 1) {
      const variants: SkillConflictVariant[] = Array.from(uniqueHashes.values()).map((items) => {
        const rep = chooseBestCandidate(items);
        return {
          source: rep.source,
          path: rep.path,
          realPath: rep.realPath,
          sha256: rep.sha256,
          description: rep.description,
          fileCount: rep.fileCount,
        };
      });
      conflicts.push({
        id,
        name: canonical.name,
        resolvedPath: preferredRealPath,
        variants,
      });
    }

    const locations: SkillLocation[] = group.map((c) => ({
      source: c.source,
      path: c.path,
      isSymlink: c.isSymlink,
      realPath: c.realPath,
      sha256: c.sha256,
    }));

    skills.push({
      id,
      name: canonical.name,
      description: canonical.description,
      sha256: canonical.sha256,
      canonicalPath: canonical.realPath,
      originSource: canonical.source,
      category: nonGeneralCategory,
      tags: Array.from(new Set(group.flatMap((g) => g.tags))),
      attachments: canonical.attachments,
      locations,
      portability: canonical.portability,
    });
  }

  return {
    skills,
    conflicts,
    candidatesCount: allCandidates.length,
  };
}
