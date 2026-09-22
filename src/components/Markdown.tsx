'use client';

import { Fragment, type ReactNode } from 'react';

/**
 * Minimal, safe markdown renderer for chat messages: fenced code, inline
 * code, **bold**, bullet lists, headings and bare links. Builds React
 * nodes — never injects HTML — so agent/LLM output cannot run scripts.
 */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const parts = text.split(/```/);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const nl = part.indexOf('\n');
      const lang = nl > 0 ? part.slice(0, nl).trim() : '';
      const code = nl > 0 ? part.slice(nl + 1) : part;
      blocks.push(
        <pre key={i} className="my-1.5 overflow-x-auto rounded-md border border-line bg-ink-950 p-2.5 font-mono text-[12px] leading-relaxed text-fg-muted">
          {lang && <div className="mb-1 text-[10px] uppercase tracking-wider text-fg-dim">{lang}</div>}
          <code>{code.replace(/\n$/, '')}</code>
        </pre>,
      );
    } else {
      blocks.push(<Fragment key={i}>{paragraphs(part, i)}</Fragment>);
    }
  });
  return <div className="space-y-1 break-words text-[13px] leading-relaxed">{blocks}</div>;
}

function paragraphs(s: string, k: number): ReactNode[] {
  const lines = s.replace(/^\n+|\n+$/g, '').split('\n');
  const out: ReactNode[] = [];
  let list: string[] = [];
  const flush = (key: string) => {
    if (list.length) {
      out.push(
        <ul key={key} className="ml-4 list-disc space-y-0.5 marker:text-fg-dim">
          {list.map((li, j) => (
            <li key={j}>{inline(li)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  lines.forEach((line, j) => {
    const m = line.match(/^\s*[-*]\s+(.*)$/);
    if (m) {
      list.push(m[1]);
      return;
    }
    flush(`${k}-l${j}`);
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) out.push(<div key={`${k}-${j}`} className="pt-1 font-semibold text-fg">{inline(h[1])}</div>);
    else if (line.trim() === '') out.push(<div key={`${k}-${j}`} className="h-1.5" />);
    else out.push(<div key={`${k}-${j}`}>{inline(line)}</div>);
  });
  flush(`${k}-end`);
  return out;
}

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('`')) out.push(<code key={i++} className="rounded bg-ink-800 px-1 py-px font-mono text-[12px] text-fg">{t.slice(1, -1)}</code>);
    else if (t.startsWith('**')) out.push(<strong key={i++} className="font-semibold text-fg">{t.slice(2, -2)}</strong>);
    else
      out.push(
        <a key={i++} href={t} target="_blank" rel="noopener noreferrer nofollow" className="text-st-waiting underline decoration-dotted underline-offset-2">
          {t}
        </a>,
      );
    last = m.index + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
