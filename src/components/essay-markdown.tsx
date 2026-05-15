'use client';

import { Fragment, type ReactNode } from 'react';

/**
 * Minimal, safe markdown renderer for synthesis essays. No
 * dangerouslySetInnerHTML — we parse a small, predictable subset of what the
 * LLM emits: ATX headings, paragraphs, bullet lists, bold, italic, and inline
 * [n] citations (rendered as small superscript chips).
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Tokenize on **bold**, *italic*, and [12] citations.
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|\[\d+\])/g;
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
      nodes.push(
        <sup key={`${keyPrefix}-c${i}`} className="essay-cite">
          {token.slice(1, -1)}
        </sup>,
      );
    }
    i += 1;
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    nodes.push(<Fragment key={`${keyPrefix}-t${i}`}>{text.slice(lastIndex)}</Fragment>);
  }
  return nodes;
}

export function EssayMarkdown({ source }: { source: string }) {
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
          {renderInline(text, `p${key}`)}
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
          <li key={idx}>{renderInline(item, `ul${key}-${idx}`)}</li>
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
          {renderInline(content, `h${key}`)}
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

  return <div className="essay-body">{blocks}</div>;
}
