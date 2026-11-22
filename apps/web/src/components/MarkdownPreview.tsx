import React from 'react';

/**
 * Lightweight, zero-dependency Markdown renderer for SKILL.md inspection.
 */
export const MarkdownPreview: React.FC<{ content: string; dark: boolean }> = ({
  content,
  dark,
}) => {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const elements: React.ReactNode[] = [];
  let inCode = false;
  let codeLang = '';
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.startsWith('```')) {
      if (!inCode) {
        inCode = true;
        codeLang = line.slice(3).trim();
        codeLines = [];
      } else {
        elements.push(
          <pre
            key={`code-${i}`}
            className={`my-3 overflow-x-auto rounded-lg border p-3 text-xs font-mono ${
              dark
                ? 'border-zinc-800 bg-zinc-950 text-zinc-200'
                : 'border-zinc-200 bg-zinc-50 text-zinc-800'
            }`}
          >
            {codeLang && (
              <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
                {codeLang}
              </div>
            )}
            <code>{codeLines.join('\n')}</code>
          </pre>
        );
        inCode = false;
        codeLang = '';
        codeLines = [];
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (line.startsWith('# ')) {
      elements.push(
        <h1 key={i} className="mt-4 mb-2 text-lg font-semibold">
          {line.slice(2)}
        </h1>
      );
    } else if (line.startsWith('## ')) {
      elements.push(
        <h2 key={i} className="mt-4 mb-1.5 text-base font-semibold">
          {line.slice(3)}
        </h2>
      );
    } else if (line.startsWith('### ')) {
      elements.push(
        <h3 key={i} className="mt-3 mb-1 text-sm font-semibold">
          {line.slice(4)}
        </h3>
      );
    } else if (line.trim() === '---') {
      elements.push(
        <hr key={i} className={`my-3 ${dark ? 'border-zinc-800' : 'border-zinc-200'}`} />
      );
    } else if (/^\s*[-*]\s+/.test(line)) {
      elements.push(
        <li key={i} className="ml-4 list-disc text-sm leading-relaxed">
          {line.replace(/^\s*[-*]\s+/, '')}
        </li>
      );
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="h-2" />);
    } else {
      elements.push(
        <p key={i} className="text-sm leading-relaxed">
          {line}
        </p>
      );
    }
  }

  return <div className="space-y-0.5">{elements}</div>;
};
