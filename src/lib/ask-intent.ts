/**
 * Tiny heuristic for "is this a question vs. a search?" used by the global
 * search input to route between retrieval (search) and Q&A (ask).
 */

const QUESTION_STARTS = new Set([
  'what',
  'how',
  'why',
  'when',
  'where',
  'who',
  'whom',
  'whose',
  'which',
  'can',
  'could',
  'should',
  'would',
  'will',
  'do',
  'does',
  'did',
  'is',
  'are',
  'was',
  'were',
  'am',
  'have',
  'has',
  'had',
  'tell',
  'show',
  'explain',
  'summarize',
  'compare',
  'list',
]);

export function isQuestion(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (trimmed.endsWith('?')) return true;
  if (trimmed.length < 8) return false;
  const firstWord = trimmed.toLowerCase().split(/\s+/)[0];
  return QUESTION_STARTS.has(firstWord);
}
