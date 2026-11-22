import type { SkillPortability, SkillWarning } from '../types.js';

interface PortabilityPattern {
  code: string;
  regex: RegExp;
  severity: 'warn' | 'info';
  message: (match: string) => string;
}

const PORTABILITY_PATTERNS: PortabilityPattern[] = [
  {
    code: 'hermes_tool_ref',
    regex: /`(execute_code|hermes_cron|schedule_cronjob|send_message|memory_search|clarify)`|\bhermes\s+plugins?\b/i,
    severity: 'warn',
    message: (m) =>
      `References Hermes-specific tool/plugin (${m}); other harnesses may use different tool names.`,
  },
  {
    code: 'hermes_path_ref',
    regex: /(?:~\/|\$HOME\/|\/Users\/[^/\s]+\/)\.hermes\b/,
    severity: 'warn',
    message: (m) =>
      `Hardcodes Hermes home path (${m}); check if another harness needs shared paths instead.`,
  },
  {
    code: 'claude_path_ref',
    regex: /(?:~\/|\$HOME\/|\/Users\/[^/\s]+\/)\.claude\b/,
    severity: 'info',
    message: (m) => `References Claude Code directory (${m}).`,
  },
  {
    code: 'codex_path_ref',
    regex: /(?:~\/|\$HOME\/|\/Users\/[^/\s]+\/)\.codex\b/,
    severity: 'info',
    message: (m) => `References Codex directory (${m}).`,
  },
];

/**
 * Analyze a SKILL.md document for cross-harness portability:
 * 1. Valid YAML frontmatter (`name` + `description` required by Codex/OpenCode/Antigravity triggers)
 * 2. Harness-specific tool names or hardcoded home paths
 * 3. External scripts present that may depend on host binaries
 */
export function analyzeSkillPortability(options: {
  hasName: boolean;
  hasDescription: boolean;
  body: string;
  attachments: string[];
}): SkillPortability {
  const warnings: SkillWarning[] = [];

  if (!options.hasName) {
    warnings.push({
      code: 'missing_name',
      severity: 'warn',
      message: 'YAML frontmatter is missing `name` (recommended for cross-agent discovery).',
    });
  }

  if (!options.hasDescription) {
    warnings.push({
      code: 'missing_description',
      severity: 'warn',
      message:
        'YAML frontmatter is missing `description`; Codex & OpenCode use description to auto-trigger skills.',
    });
  }

  for (const rule of PORTABILITY_PATTERNS) {
    const match = rule.regex.exec(options.body);
    if (match) {
      warnings.push({
        code: rule.code,
        severity: rule.severity,
        message: rule.message(match[0]),
      });
    }
  }

  const scriptCount = options.attachments.filter((a) => a.startsWith('scripts/')).length;
  if (scriptCount > 0) {
    warnings.push({
      code: 'has_scripts',
      severity: 'info',
      message: `Includes ${scriptCount} script(s) under scripts/ — ensure target harness has shell/runtime access.`,
    });
  }

  let status: SkillPortability['status'] = 'portable';
  if (!options.hasDescription) {
    status = 'incomplete';
  } else if (warnings.some((w) => w.severity === 'warn')) {
    status = 'caution';
  }

  return {
    status,
    hasName: options.hasName,
    hasDescription: options.hasDescription,
    warnings,
  };
}
