import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractArticlePublishedAt, scrapeUrl } from './scrape';

describe('extractArticlePublishedAt', () => {
  it('reads article:published_time meta', () => {
    const html = `<html><head><meta property="article:published_time" content="2023-06-15T12:34:56Z"></head></html>`;
    expect(extractArticlePublishedAt(html)).toBe('2023-06-15T12:34:56.000Z');
  });
  it('reads og:article:published_time', () => {
    const html = `<html><head><meta property="og:article:published_time" content="2024-01-02T03:04:05+05:00"></head></html>`;
    expect(extractArticlePublishedAt(html)).toBe('2024-01-01T22:04:05.000Z');
  });
  it('reads JSON-LD datePublished', () => {
    const html = `<html><head><script type="application/ld+json">{"@type":"Article","datePublished":"2020-11-30T08:00:00Z"}</script></head></html>`;
    expect(extractArticlePublishedAt(html)).toBe('2020-11-30T08:00:00.000Z');
  });
  it('reads <time datetime>', () => {
    const html = `<html><body><article><time datetime="2019-04-01">April 1</time></article></body></html>`;
    expect(extractArticlePublishedAt(html)).toBe('2019-04-01T00:00:00.000Z');
  });
  it('falls back to meta itemprop="datePublished"', () => {
    const html = `<html><body><meta itemprop="datePublished" content="2018-07-04T00:00:00Z"></body></html>`;
    expect(extractArticlePublishedAt(html)).toBe('2018-07-04T00:00:00.000Z');
  });
  it('returns undefined when no date is present', () => {
    expect(extractArticlePublishedAt('<html><head></head><body></body></html>')).toBeUndefined();
  });
  it('skips a malformed value and tries the next source', () => {
    const html = `
      <html><head>
        <meta property="article:published_time" content="not-a-date">
        <meta name="datePublished" content="2022-02-22T00:00:00Z">
      </head></html>`;
    expect(extractArticlePublishedAt(html)).toBe('2022-02-22T00:00:00.000Z');
  });
});

describe('scrapeUrl bot-challenge handling', () => {
  const ARTICLE_URL =
    'https://medium.com/the-coil/the-situationist-international-art-and-radical-politics-mary-joyce-67f66766cb90';

  const challengeResponse = () =>
    new Response('<html><head><title>Just a moment...</title></head><body></body></html>', {
      status: 403,
      headers: { 'content-type': 'text/html' },
    });

  const articleResponse = () =>
    new Response(
      `<html><head>
        <title>Real Title</title>
        <meta property="og:title" content="The Situationist International: Art &amp; Radical Politics">
        <meta property="og:image" content="https://example.com/cover.jpg">
      </head><body><article><p>${'Guy Debord and the Situationist International. '.repeat(20)}</p></article></body></html>`,
      { status: 200, headers: { 'content-type': 'text/html' } },
    );

  const notFound = () => new Response('', { status: 404 });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries with browser-like headers when the first response is a challenge page', async () => {
    const calls: { url: string; ua: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('llms.txt') || url.includes('llm.txt')) return notFound();
        const ua = (init?.headers as Record<string, string>)?.['user-agent'] ?? '';
        calls.push({ url, ua });
        return calls.length === 1 ? challengeResponse() : articleResponse();
      }),
    );

    const result = await scrapeUrl(ARTICLE_URL);
    expect(result.title).toBe('The Situationist International: Art & Radical Politics');
    expect(result.image).toBe('https://example.com/cover.jpg');
    expect(calls).toHaveLength(2);
    expect(calls[0].ua).toBe('MuttMindBot/1.0');
    expect(calls[1].ua).toContain('Mozilla/5.0');
  });

  it('never persists the challenge title — falls back to a slug-derived title', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('llms.txt') || url.includes('llm.txt')) return notFound();
        return challengeResponse();
      }),
    );

    const result = await scrapeUrl(ARTICLE_URL);
    expect(result.title).toBe('The situationist international art and radical politics mary joyce');
    expect(result.title).not.toMatch(/just a moment/i);
    expect(result.image).toBe('');
    expect(result.extractionWarnings.join(' ')).toMatch(/bot challenge/i);
  });
});
