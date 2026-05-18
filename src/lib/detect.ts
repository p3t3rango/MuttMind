/**
 * Pure, client-safe URL/content classification for the capture composer's
 * live "what did we detect" hint. No network — this only inspects the typed
 * text. The server (scrape.ts) remains authoritative for what's stored; this
 * is UX feedback so the user knows what will happen before they hit save.
 *
 * Host-match approach ported from Roomtone/lib/embed.ts.
 */

export type DetectedKind =
  | 'note'
  | 'article'
  | 'pdf'
  | 'youtube'
  | 'tweet'
  | 'image'
  | 'music'
  | 'link';

export type Detection = {
  kind: DetectedKind;
  /** Human provider name when known: YouTube, X, Spotify, Apple Music, or host. */
  provider?: string;
  /** The extracted URL, if the text contained one. */
  url?: string;
  /** One-line banner copy describing what capture will do. */
  label: string;
};

/** Pull the first URL out of arbitrary pasted/typed text. */
export function extractUrl(value: string): string {
  const match = value.match(
    /https?:\/\/[^\s]+|www\.[^\s]+|[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?/i,
  );
  if (!match) return '';
  const url = match[0].replace(/[),.;]+$/, '');
  return url.startsWith('http') ? url : `https://${url}`;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i;

export function detectUrlKind(text: string): Detection {
  const raw = extractUrl(text.trim());
  if (!raw) {
    return { kind: 'note', label: 'Note — saved as text' };
  }

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { kind: 'note', label: 'Note — saved as text' };
  }

  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const path = u.pathname;

  if (host === 'youtu.be' || host.endsWith('youtube.com')) {
    return {
      kind: 'youtube',
      provider: 'YouTube',
      url: raw,
      label: 'YouTube — transcript pulled if captions exist',
    };
  }

  if ((host === 'x.com' || host === 'twitter.com') && /\/status\//.test(path)) {
    return {
      kind: 'tweet',
      provider: 'X',
      url: raw,
      label: 'X post — full text via syndication (single post, no thread)',
    };
  }

  if (host === 'open.spotify.com') {
    return { kind: 'music', provider: 'Spotify', url: raw, label: 'Spotify link' };
  }

  if (host === 'music.apple.com' || host === 'embed.music.apple.com') {
    return { kind: 'music', provider: 'Apple Music', url: raw, label: 'Apple Music link' };
  }

  if (u.protocol === 'application/pdf:' || /\.pdf(\?|#|$)/i.test(path) || /\/pdf\//.test(path)) {
    return { kind: 'pdf', provider: host, url: raw, label: 'PDF — full document text extracted' };
  }

  if (IMAGE_EXT.test(path)) {
    return { kind: 'image', provider: host, url: raw, label: 'Image' };
  }

  return {
    kind: 'article',
    provider: host,
    url: raw,
    label: `Link from ${host} — readable text extracted`,
  };
}
