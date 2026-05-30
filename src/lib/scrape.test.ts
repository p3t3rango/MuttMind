import { describe, expect, it } from 'vitest';
import { extractArticlePublishedAt } from './scrape';

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
