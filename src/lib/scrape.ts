import * as cheerio from 'cheerio';

type Cheerio = ReturnType<typeof cheerio.load>;

/**
 * Apple touch icons are commonly served at 180x180 PNG and tend to be the
 * brand/wordmark image — fine fallback when og:image is absent. Prefer the
 * largest declared size when multiple are present.
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
 * Scan the body for the first <img> that's not obviously a tracking pixel,
 * UI icon, base64-inlined SVG, or social-button glyph. Skips images with
 * declared width or height under 100. Skips data: URIs (these tend to be
 * inline icons, never hero images).
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
    // Heuristic: skip obvious icon/avatar/logo paths.
    if (/(?:^|\/)(?:icons?|avatars?|favicons?|logos?\/(?:small|tiny|mini))\//i.test(src)) return;
    found = src;
  });
  return found;
}

async function fetchAuxiliaryText(baseUrl: string) {
  const origin = new URL(baseUrl).origin;
  const candidates = ['/llms.txt', '/llm.txt'];
  const results: string[] = [];

  for (const path of candidates) {
    try {
      const res = await fetch(`${origin}${path}`, {
        headers: { 'user-agent': 'MuttMindBot/1.0' },
        signal: AbortSignal.timeout(3500),
      });
      if (!res.ok) continue;
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('text') && !contentType.includes('markdown')) continue;
      const text = (await res.text()).replace(/\s+/g, ' ').trim();
      if (text) results.push(`${path}: ${text.slice(0, 5000)}`);
    } catch {
      // Auxiliary context is best-effort.
    }
  }

  return results.join('\n');
}

export async function scrapeUrl(url: string) {
  const res = await fetch(url, { headers: { 'user-agent': 'MuttMindBot/1.0' } });
  const contentType = res.headers.get('content-type') ?? '';
  const parsedUrl = new URL(url);
  const fallbackTitle = decodeURIComponent(parsedUrl.pathname.split('/').filter(Boolean).pop() ?? parsedUrl.hostname);
  const auxiliaryText = await fetchAuxiliaryText(url);

  if (!contentType.includes('text/html')) {
    return {
      title: fallbackTitle,
      description: contentType.includes('pdf')
        ? `PDF document from ${parsedUrl.hostname.replace(/^www\./, '')}.`
        : contentType.includes('image')
          ? `Image from ${parsedUrl.hostname.replace(/^www\./, '')}.`
          : `File from ${parsedUrl.hostname.replace(/^www\./, '')}.`,
      image: contentType.includes('image') ? url : '',
      author: '',
      text: auxiliaryText,
    };
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const pick = (selector: string, attribute = 'content') => $(selector).attr(attribute)?.trim() ?? '';

  // Image extraction with progressive fallbacks. og: / twitter: / image_src
  // are the meta-tag standards. Apple touch icons are usually high-quality
  // wordmark-or-app-icon images (180x180 PNG). The body scan picks the first
  // visible image that's not a tracking pixel or icon.
  const image =
    pick('meta[property="og:image"]') ||
    pick('meta[property="og:image:secure_url"]') ||
    pick('meta[name="twitter:image"]') ||
    pick('meta[name="twitter:image:src"]') ||
    pick('link[rel="image_src"]', 'href') ||
    pickAppleTouchIcon($) ||
    pickFirstReasonableBodyImage($);

  $('script, style, noscript, svg, iframe, nav, footer, header').remove();
  const articleText = $('article').text().trim() || $('main').text().trim() || $('body').text().trim();
  const text = [articleText.replace(/\s+/g, ' ').slice(0, 5000), auxiliaryText].filter(Boolean).join('\n');
  const resolvedImage = image ? new URL(image, url).toString() : '';

  return {
    title: pick('meta[property="og:title"]') || $('title').text().trim(),
    description: pick('meta[property="og:description"]') || pick('meta[name="description"]'),
    image: resolvedImage,
    author: pick('meta[name="author"]'),
    text,
  };
}
