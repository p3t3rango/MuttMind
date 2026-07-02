/**
 * Tag vocabulary folding. Generated tags only reuse existing ones on exact
 * string match, so `zine`/`zines` and `sci-fi`/`scifi` accumulate as separate
 * tags — which also weakens the map's shared-tag edges. foldTags() maps each
 * candidate onto an established tag when they differ only by plural form or
 * hyphenation, and dedupes near-duplicates within the batch itself.
 */

/**
 * Conservative English singularizer for the last word of a kebab tag. Misses
 * irregulars (movies → movy ≠ movie) on purpose: a missed fold keeps two tags,
 * a wrong fold silently merges different concepts.
 */
function singularizeWord(word: string): string {
  if (word.length >= 5 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length >= 5 && /(?:s|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.length >= 5 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** Canonical identity: hyphen-insensitive, last word singularized. */
function tagKey(tag: string): string {
  const segments = tag.split('-').filter(Boolean);
  if (!segments.length) return tag;
  segments[segments.length - 1] = singularizeWord(segments[segments.length - 1]);
  return segments.join('');
}

export function foldTags(candidates: string[], existing: string[]): string[] {
  const existingByKey = new Map<string, string>();
  for (const tag of existing) {
    const key = tagKey(tag);
    if (!existingByKey.has(key)) existingByKey.set(key, tag);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate) continue;
    const key = tagKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(existingByKey.get(key) ?? candidate);
  }
  return out;
}
