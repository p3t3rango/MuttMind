import * as cheerio from 'cheerio';
import { env } from './env';

type Cheerio = ReturnType<typeof cheerio.load>;

/**
 * Walk the conventional places a publish date hides in an article: standard
 * Open Graph / itemprop meta tags, JSON-LD `datePublished`, and the first
 * `<time datetime="…">`. Returns an ISO string; undefined if nothing parses.
 */
export function extractArticlePublishedAt(htmlOrCheerio: string | Cheerio): string | undefined {
  const $ = typeof htmlOrCheerio === 'string' ? cheerio.load(htmlOrCheerio) : htmlOrCheerio;

  const candidates: string[] = [];
  const pickMeta = (sel: string) => {
    const v = $(sel).attr('content')?.trim();
    if (v) candidates.push(v);
  };
  pickMeta('meta[property="article:published_time"]');
  pickMeta('meta[property="og:article:published_time"]');
  pickMeta('meta[name="datePublished"]');
  pickMeta('meta[itemprop="datePublished"]');

  $('script[type="application/ld+json"]').each((_, el) => {
    const text = $(el).text();
    try {
      const data = JSON.parse(text);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const v = item?.datePublished ?? item?.dateCreated;
        if (typeof v === 'string' && v.trim()) candidates.push(v.trim());
      }
    } catch {
      // not JSON; skip
    }
  });

  const t = $('time[datetime]').first().attr('datetime')?.trim();
  if (t) candidates.push(t);

  for (const raw of candidates) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return undefined;
}

export type ScrapeKind = 'article' | 'pdf' | 'youtube' | 'tweet' | 'image' | 'file';

export type ScrapeResult = {
  title: string;
  description: string;
  image: string;
  author: string;
  text: string;
  kind: ScrapeKind;
  truncated: boolean;
  extractionWarnings: string[];
  publishedAt?: string;
};

const FETCH_TIMEOUT_MS = 20_000;
// ~100k tokens of prose — effectively non-lossy for real captures while
// bounding a pathological 500-page PDF from blowing up the row / LLM cost.
const MAX_TEXT_CHARS = 400_000;
const UA = 'MuttMindBot/1.0';
// Retry identity for hosts that challenge unknown bots (Cloudflare et al.).
// We announce ourselves honestly first; this is the fallback, not the default.
const BROWSER_HEADERS: Record<string, string> = {
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

const CHALLENGE_TITLE = /^\s*(just a moment|attention required|access denied|verify(ing)? you are|are you a robot|one more step|please wait)/i;

/**
 * Bot-mitigation interstitials (Cloudflare "Just a moment...", etc.) parse as
 * tiny "articles" — without this check we'd persist the challenge page's
 * title as the capture title.
 */
function looksLikeBotChallenge(res: Response, result: ScrapeResult): boolean {
  if (res.headers.get('cf-mitigated') === 'challenge') return true;
  const thin = result.text.length < 500;
  if (thin && CHALLENGE_TITLE.test(result.title)) return true;
  if ((res.status === 403 || res.status === 503) && thin) return true;
  return false;
}

/** "the-situationist-international-art-67f66766cb90" → "The situationist international art" */
function humanizedFallbackTitle(url: URL): string {
  const slug = url.pathname.split('/').filter(Boolean).pop() ?? '';
  if (!slug) return hostnameOf(url);
  const parts = decodeURIComponent(slug).replace(/\.(html?|php|aspx?)$/i, '').split('-');
  if (parts.length > 1 && /^[0-9a-f]{8,}$/i.test(parts[parts.length - 1])) parts.pop();
  const text = parts.join(' ').trim();
  if (!text) return hostnameOf(url);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Collapse intra-line whitespace but PRESERVE paragraph breaks. Stage 2
 * chunking splits on \n\n, so we must not flatten newlines the way the old
 * scraper did.
 */
function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function applyCeiling(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_TEXT_CHARS) return { text, truncated: false };
  return { text: `${text.slice(0, MAX_TEXT_CHARS)}\n\n[…truncated at ${MAX_TEXT_CHARS} chars]`, truncated: true };
}

function hostnameOf(url: URL): string {
  return url.hostname.replace(/^www\./, '');
}

function fallbackTitleFrom(url: URL): string {
  return decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? url.hostname);
}

/**
 * Apple touch icons are commonly served at 180x180 PNG and tend to be the
 * brand/wordmark image — fine fallback when og:image is absent.
 */
function pickAppleTouchIcon($: Cheerio): string {
  const candidates: { href: string; size: number }[] = [];
  $('link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]').each((_, el) => {
    const href = $(el).attr('href')?.trim();
    if (!href) return;
    const sizesAttr = $(el).attr('sizes') ?? '';
    const sizeMatch = sizesAttr.match(/(\d+)x(\d+)/);
    const size = sizeMatch ? parseInt(sizeMatch[1], 10) : 0;
    candidates.push({ href, size });
  });
  candidates.sort((a, b) => b.size - a.size);
  return candidates[0]?.href ?? '';
}

/**
 * First <img> that's not obviously a tracking pixel, UI icon, inlined SVG, or
 * social-button glyph.
 */
function pickFirstReasonableBodyImage($: Cheerio): string {
  let found = '';
  $('img').each((_, el) => {
    if (found) return;
    const src = ($(el).attr('src') ?? $(el).attr('data-src') ?? '').trim();
    if (!src) return;
    if (src.startsWith('data:')) return;
    if (/\.svg(\?|$)/i.test(src)) return;
    const width = parseInt($(el).attr('width') ?? '0', 10);
    const height = parseInt($(el).attr('height') ?? '0', 10);
    if ((width && width < 100) || (height && height < 100)) return;
    if (/(?:^|\/)(?:icons?|avatars?|favicons?|logos?\/(?:small|tiny|mini))\//i.test(src)) return;
    found = src;
  });
  return found;
}

/**
 * Best-effort supplementary text from a site's /llms.txt. Only used when
 * primary extraction comes back thin — never as the primary source.
 */
async function fetchAuxiliaryText(baseUrl: string): Promise<string> {
  const origin = new URL(baseUrl).origin;
  const results: string[] = [];
  for (const path of ['/llms.txt', '/llm.txt']) {
    try {
      const res = await fetch(`${origin}${path}`, {
        headers: { 'user-agent': UA },
        signal: AbortSignal.timeout(3500),
      });
      if (!res.ok) continue;
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('text') && !contentType.includes('markdown')) continue;
      const text = (await res.text()).replace(/\s+/g, ' ').trim();
      if (text) results.push(`${path}: ${text.slice(0, 5000)}`);
    } catch {
      // best-effort
    }
  }
  return results.join('\n');
}

function stripTags(html: string): string {
  try {
    return cheerio.load(html).text();
  } catch {
    return html.replace(/<[^>]+>/g, ' ');
  }
}

function youtubeVideoId(url: URL): string {
  if (url.hostname.endsWith('youtu.be')) return url.pathname.split('/').filter(Boolean)[0] ?? '';
  if (url.pathname.startsWith('/watch')) return url.searchParams.get('v') ?? '';
  if (url.pathname.startsWith('/shorts/') || url.pathname.startsWith('/embed/')) {
    return url.pathname.split('/').filter(Boolean)[1] ?? '';
  }
  return url.searchParams.get('v') ?? '';
}

/**
 * Free, unofficial: the syndication/embed JSON endpoint react-tweet uses.
 * Returns full tweet text + quoted-tweet text without auth. Not contractually
 * stable and won't serve protected/age-gated tweets, but materially richer
 * than the oEmbed blockquote for the common case.
 */
function syndicationToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

async function tweetSyndication(
  tweetId: string,
): Promise<{ text: string; author: string; image: string } | null> {
  try {
    const token = syndicationToken(tweetId);
    const res = await fetch(
      `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&token=${token}`,
      { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return null;
    const d = await res.json();
    if (!d || d.__typename === 'TweetTombstone' || typeof d.text !== 'string') return null;

    const author = d.user?.name || d.user?.screen_name || '';
    const parts = [d.text as string];
    if (d.quoted_tweet?.text) {
      const qa = d.quoted_tweet.user?.name || d.quoted_tweet.user?.screen_name || '';
      parts.push(`\n\nQuoting${qa ? ` ${qa}` : ''}: ${d.quoted_tweet.text}`);
    }
    const image =
      d.mediaDetails?.find((m: { media_url_https?: string }) => m?.media_url_https)
        ?.media_url_https ||
      d.photos?.[0]?.url ||
      '';
    return { text: normalizeText(parts.join('')), author, image };
  } catch {
    return null;
  }
}

async function extractTweet(url: string, parsed: URL): Promise<ScrapeResult> {
  const warnings: string[] = [];
  const base: ScrapeResult = {
    title: `Post on ${hostnameOf(parsed)}`,
    description: '',
    image: '',
    author: '',
    text: '',
    kind: 'tweet',
    truncated: false,
    extractionWarnings: ['Thread context is not captured — only the linked post.'],
  };

  // Optional: X API v2 when a bearer token is configured (richest, exact text).
  const tweetId = parsed.pathname.split('/').filter(Boolean).pop() ?? '';
  if (env.xBearerToken && /^\d+$/.test(tweetId)) {
    try {
      const res = await fetch(
        `https://api.twitter.com/2/tweets/${tweetId}?tweet.fields=text,created_at&expansions=author_id&user.fields=name,username`,
        { headers: { authorization: `Bearer ${env.xBearerToken}` }, signal: AbortSignal.timeout(10_000) },
      );
      if (res.ok) {
        const data = await res.json();
        const author = data?.includes?.users?.[0];
        const text = data?.data?.text ?? '';
        if (text) {
          return {
            ...base,
            title: author?.name ? `${author.name} on X` : base.title,
            author: author?.name ?? author?.username ?? '',
            text: normalizeText(text),
          };
        }
      } else {
        warnings.push(`X API returned ${res.status}.`);
      }
    } catch (e) {
      warnings.push(`X API failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

  // Free, richer than oEmbed: the syndication JSON endpoint.
  if (/^\d+$/.test(tweetId)) {
    const syn = await tweetSyndication(tweetId);
    if (syn && syn.text) {
      // Extraction succeeded — don't surface earlier paid-API attempt noise.
      return {
        ...base,
        title: syn.author ? `${syn.author} on X` : base.title,
        author: syn.author,
        image: syn.image,
        text: syn.text,
        extractionWarnings: base.extractionWarnings,
      };
    }
    warnings.push('Syndication endpoint returned nothing; trying oEmbed.');
  }

  // Last resort: public oEmbed (no auth). Thin; fails for protected/deleted.
  try {
    const res = await fetch(
      `https://publish.twitter.com/oembed?omit_script=1&dnt=true&url=${encodeURIComponent(url)}`,
      { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) {
      warnings.push(`Tweet not publicly embeddable (oEmbed ${res.status}) — protected, deleted, or age-gated.`);
      return { ...base, extractionWarnings: [...base.extractionWarnings, ...warnings] };
    }
    const data = await res.json();
    const text = normalizeText(stripTags(data?.html ?? ''));
    return {
      ...base,
      title: data?.author_name ? `${data.author_name} on X` : base.title,
      author: data?.author_name ?? '',
      text,
      extractionWarnings: [...base.extractionWarnings, ...warnings],
    };
  } catch (e) {
    warnings.push(`Tweet extraction failed: ${e instanceof Error ? e.message : 'unknown'}`);
    return { ...base, extractionWarnings: [...base.extractionWarnings, ...warnings] };
  }
}

async function extractYouTube(url: string, parsed: URL): Promise<ScrapeResult> {
  const warnings: string[] = [];
  let title = fallbackTitleFrom(parsed);
  let author = '';
  let image = '';

  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
      { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8000) },
    );
    if (res.ok) {
      const data = await res.json();
      title = data?.title ?? title;
      author = data?.author_name ?? '';
      image = data?.thumbnail_url ?? '';
    }
  } catch {
    warnings.push('YouTube metadata (oEmbed) unavailable.');
  }

  let transcript = '';
  const videoId = youtubeVideoId(parsed);
  if (videoId) {
    try {
      const { YoutubeTranscript } = await import('youtube-transcript');
      // The library otherwise grabs whatever track sorts first (often an
      // auto-translated one). Prefer the English track; fall back to the
      // default only if there's no English captions at all.
      const parts = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' }).catch(() =>
        YoutubeTranscript.fetchTranscript(videoId),
      );
      transcript = normalizeText(parts.map((p) => p.text).join(' '));
    } catch {
      warnings.push('No transcript available for this video (captions off or blocked).');
    }
  }

  const ceil = applyCeiling(transcript);
  return {
    title,
    description: author ? `YouTube video by ${author}.` : 'YouTube video.',
    image,
    author,
    text: ceil.text,
    kind: 'youtube',
    truncated: ceil.truncated,
    extractionWarnings: warnings,
  };
}

async function extractPdf(buffer: ArrayBuffer, parsed: URL): Promise<ScrapeResult> {
  const warnings: string[] = [];
  let text = '';
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractText(pdf, { mergePages: true });
    text = normalizeText(Array.isArray(result.text) ? result.text.join('\n\n') : result.text);
  } catch (e) {
    warnings.push(`PDF text extraction failed: ${e instanceof Error ? e.message : 'unknown'}`);
  }
  const ceil = applyCeiling(text);
  return {
    title: fallbackTitleFrom(parsed),
    description: `PDF document from ${hostnameOf(parsed)}.`,
    image: '',
    author: '',
    text: ceil.text,
    kind: 'pdf',
    truncated: ceil.truncated,
    extractionWarnings: warnings,
  };
}

async function extractArticle(html: string, url: string): Promise<ScrapeResult> {
  const warnings: string[] = [];
  const $ = cheerio.load(html);
  const pick = (selector: string, attribute = 'content') => $(selector).attr(attribute)?.trim() ?? '';

  const rawImage =
    pick('meta[property="og:image"]') ||
    pick('meta[property="og:image:secure_url"]') ||
    pick('meta[name="twitter:image"]') ||
    pick('meta[name="twitter:image:src"]') ||
    pick('link[rel="image_src"]', 'href') ||
    pickAppleTouchIcon($) ||
    pickFirstReasonableBodyImage($);
  const image = rawImage ? new URL(rawImage, url).toString() : '';
  const metaTitle = pick('meta[property="og:title"]') || $('title').text().trim();
  const description = pick('meta[property="og:description"]') || pick('meta[name="description"]');
  const metaAuthor = pick('meta[name="author"]');

  // Primary: Readability (real article extraction). Fallback: the old
  // <article>|<main>|<body> sweep — minus the 5k slice.
  let body = '';
  let byline = '';
  try {
    const { JSDOM } = await import('jsdom');
    const { Readability } = await import('@mozilla/readability');
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    if (article?.textContent && article.textContent.trim().length >= 200) {
      body = article.textContent;
      byline = article.byline ?? '';
    } else {
      warnings.push('Readability found little content; used structural fallback.');
    }
  } catch (e) {
    warnings.push(`Readability failed (${e instanceof Error ? e.message : 'unknown'}); used structural fallback.`);
  }

  if (!body) {
    const f = cheerio.load(html);
    f('script, style, noscript, svg, iframe, nav, footer, header').remove();
    body = f('article').text().trim() || f('main').text().trim() || f('body').text().trim();
  }

  let text = normalizeText(body);
  if (text.length < 500) {
    const aux = await fetchAuxiliaryText(url);
    if (aux) text = normalizeText([text, aux].filter(Boolean).join('\n\n'));
  }
  const ceil = applyCeiling(text);

  return {
    title: metaTitle,
    description,
    image,
    author: metaAuthor || byline,
    text: ceil.text,
    kind: 'article',
    truncated: ceil.truncated,
    extractionWarnings: warnings,
    publishedAt: extractArticlePublishedAt($),
  };
}

export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      title: url,
      description: '',
      image: '',
      author: '',
      text: '',
      kind: 'file',
      truncated: false,
      extractionWarnings: ['Invalid URL.'],
    };
  }

  const host = parsed.hostname.replace(/^www\./, '');

  if ((host === 'x.com' || host === 'twitter.com') && parsed.pathname.includes('/status/')) {
    return extractTweet(url, parsed);
  }
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com') {
    return extractYouTube(url, parsed);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    return {
      title: fallbackTitleFrom(parsed),
      description: `Could not reach ${host}.`,
      image: '',
      author: '',
      text: '',
      kind: 'file',
      truncated: false,
      extractionWarnings: [`Fetch failed: ${e instanceof Error ? e.message : 'unknown'}`],
    };
  }

  const contentType = res.headers.get('content-type') ?? '';

  if (contentType.includes('application/pdf') || /\.pdf(\?|$)/i.test(parsed.pathname)) {
    try {
      return await extractPdf(await res.arrayBuffer(), parsed);
    } catch (e) {
      return {
        title: fallbackTitleFrom(parsed),
        description: `PDF document from ${host}.`,
        image: '',
        author: '',
        text: '',
        kind: 'pdf',
        truncated: false,
        extractionWarnings: [`PDF read failed: ${e instanceof Error ? e.message : 'unknown'}`],
      };
    }
  }

  if (contentType.includes('text/html')) {
    try {
      const first = await extractArticle(await res.text(), url);
      if (!looksLikeBotChallenge(res, first)) return first;

      // Challenged (e.g. Cloudflare "Just a moment..."): one retry with
      // browser-like headers, which most non-JS challenge tiers accept.
      try {
        const retry = await fetch(url, {
          headers: BROWSER_HEADERS,
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if ((retry.headers.get('content-type') ?? '').includes('text/html')) {
          const second = await extractArticle(await retry.text(), url);
          if (!looksLikeBotChallenge(retry, second)) return second;
        }
      } catch {
        // fall through to the graceful fallback below
      }

      // Still blocked: save the link with a slug-derived title rather than
      // persisting the challenge page's "Just a moment..." metadata.
      return {
        title: humanizedFallbackTitle(parsed),
        description: '',
        image: '',
        author: '',
        text: '',
        kind: 'article',
        truncated: false,
        extractionWarnings: [
          `${host} blocked automated access (bot challenge) — saved the link without article text. Try re-processing later.`,
        ],
      };
    } catch (e) {
      return {
        title: fallbackTitleFrom(parsed),
        description: '',
        image: '',
        author: '',
        text: '',
        kind: 'article',
        truncated: false,
        extractionWarnings: [`HTML extraction failed: ${e instanceof Error ? e.message : 'unknown'}`],
      };
    }
  }

  if (contentType.includes('image')) {
    return {
      title: fallbackTitleFrom(parsed),
      description: `Image from ${host}.`,
      image: url,
      author: '',
      text: '',
      kind: 'image',
      truncated: false,
      extractionWarnings: [],
    };
  }

  return {
    title: fallbackTitleFrom(parsed),
    description: `File from ${host}.`,
    image: '',
    author: '',
    text: '',
    kind: 'file',
    truncated: false,
    extractionWarnings: [],
  };
}
