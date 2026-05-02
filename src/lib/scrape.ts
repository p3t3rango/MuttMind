import * as cheerio from 'cheerio';

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
  const image =
    pick('meta[property="og:image"]') ||
    pick('meta[property="og:image:secure_url"]') ||
    pick('meta[name="twitter:image"]') ||
    pick('meta[name="twitter:image:src"]') ||
    pick('link[rel="image_src"]', 'href');

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
