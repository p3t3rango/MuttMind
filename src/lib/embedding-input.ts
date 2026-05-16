/**
 * Gemini's embedding endpoint caps input (~2048 tokens). Build the embed text
 * by leading with short, high-signal fields, then filling the remaining char
 * budget with the head of the long body. Centralized so capture and
 * node-reprocessing stay consistent; Stage 2 chunk-level embeddings will
 * replace this with per-passage vectors.
 */
export function buildEmbeddingInput(
  headParts: Array<string | null | undefined>,
  body: string | null | undefined,
  cap = 6_000,
): string {
  const head = headParts
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  const budget = Math.max(0, cap - head.length);
  return [head, (body ?? '').slice(0, budget)].filter(Boolean).join('\n').trim();
}
