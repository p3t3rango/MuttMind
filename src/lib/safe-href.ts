/**
 * Returns the URL only if its scheme is http or https — otherwise null.
 * Used to guard against `javascript:`, `data:`, `vbscript:`, etc. being bound
 * to <a href>. Captures store user-supplied URLs in `nodes.original_url`; that
 * field is the primary stored-XSS surface.
 */
export function safeHttpHref(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null;
  return /^https?:\/\//i.test(url.trim()) ? url : null;
}
