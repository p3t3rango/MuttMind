export function parseEmbedding(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  }

  if (typeof value === 'string') {
    return value
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item));
  }

  return [];
}

/**
 * Cosine similarity between two equal-length vectors. Returns 0 when either
 * vector is empty, zero-magnitude, or length-mismatched (so callers can treat
 * "no signal" and "no similarity" the same way).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Mean vector of a set of equal-length embeddings, L2-normalized. Vectors that
 * don't match the first one's dimensionality are skipped. Returns [] if no
 * usable vectors.
 */
export function centroid(vectors: number[][]): number[] {
  const usable = vectors.filter((v) => v.length > 0);
  if (!usable.length) return [];
  const dim = usable[0].length;
  const sum = new Array<number>(dim).fill(0);
  let count = 0;
  for (const v of usable) {
    if (v.length !== dim) continue;
    for (let i = 0; i < dim; i += 1) sum[i] += v[i];
    count += 1;
  }
  if (count === 0) return [];
  let norm = 0;
  for (let i = 0; i < dim; i += 1) {
    sum[i] /= count;
    norm += sum[i] * sum[i];
  }
  if (norm === 0) return sum;
  const mag = Math.sqrt(norm);
  return sum.map((x) => x / mag);
}

