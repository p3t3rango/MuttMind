'use client';

import { Fragment, type ReactNode } from 'react';

/**
 * Minimal, safe markdown renderer for synthesis essays. No
 * dangerouslySetInnerHTML — we parse a small, predictable subset of what the
 * LLM emits: ATX headings, paragraphs, bullet lists, bold, italic, and inline
 * [n] / [n, m] citations rendered as clickable superscript chips that jump to
 * a Sources list.
 */

export type EssaySource = { n: number; title: string; url: string | null };

function renderInline(
  text: string,
  keyPrefix: string,
  sources: Map<number, EssaySource>,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  // **bold**, *italic*, and [12] / [1, 2] / [1,2] citation groups.
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|\[\s*\d+(?:\s*,\s*\d+)*\s*\])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<Fragment key={`${keyPrefix}-t${i}`}>{text.slice(lastIndex, match.index)}</Fragment>);
      i += 1;
    }
    const token = match[0];
    if (token.startsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-b${i}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*')) {
      nodes.push(<em key={`${keyPrefix}-i${i}`}>{token.slice(1, -1)}</em>);
    } else {
      const numbers = token
        .slice(1, -1)
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n));
      numbers.forEach((num, idx) => {
        const known = sources.has(num);
        nodes.push(
          known ? (
            <a
              key={`${keyPrefix}-c${i}-${idx}`}
              href={`#essay-src-${num}`}
              className="essay-cite essay-cite--link"
              aria-label={`Source ${num}: ${sources.get(num)?.title ?? ''}`}
            >
              {num}
            </a>
          ) : (
            <sup key={`${keyPrefix}-c${i}-${idx}`} className="essay-cite">
              {num}
            </sup>
          ),
        );
      });
    }
    i += 1;
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    nodes.push(<Fragment key={`${keyPrefix}-t${i}`}>{text.slice(lastIndex)}</Fragment>);
  }
  return nodes;
}

export function EssayMarkdown({
  source,
  sources = [],
}: {
  source: string;
  sources?: EssaySource[];
}) {
  const sourceMap = new Map(sources.map((s) => [s.n, s]));
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let key = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(' ').trim();
    if (text) {
      blocks.push(
        <p key={`p${key}`} className="essay-p">
          {renderInline(text, `p${key}`, sourceMap)}
        </p>,
      );
      key += 1;
    }
    paragraph = [];
  };

  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={`ul${key}`} className="essay-ul">
        {list.map((item, idx) => (
          <li key={idx}>{renderInline(item, `ul${key}-${idx}`, sourceMap)}</li>
        ))}
      </ul>,
    );
    key += 1;
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const bullet = line.match(/^[-*]\s+(.*)$/);

    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      const content = heading[2];
      const cls = level <= 1 ? 'essay-h1' : level === 2 ? 'essay-h2' : 'essay-h3';
      blocks.push(
        <p key={`h${key}`} className={cls}>
          {renderInline(content, `h${key}`, sourceMap)}
        </p>,
      );
      key += 1;
      continue;
    }

    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }

    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();

  return (
    <div className="essay-body">
      {blocks}
      {sources.length ? (
        <ol className="essay-sources">
          {sources.map((s) => (
            <li key={s.n} id={`essay-src-${s.n}`} className="essay-sources__item">
              <span className="essay-sources__n">{s.n}</span>
              {s.url ? (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="essay-sources__link"
                >
                  {s.title || s.url}
                </a>
              ) : (
                <span className="essay-sources__title">{s.title || 'Untitled'}</span>
              )}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
