/**
 * Passage chunking for per-chunk embeddings (Stage 2).
 *
 * Splits on the paragraph breaks scrape.ts now preserves (\n\n), greedily
 * packing paragraphs into ~1k-token windows with a small sentence-level
 * overlap so a passage that straddles a boundary isn't lost. Oversized single
 * paragraphs are hard-split at sentence boundaries. Token count is the usual
 * chars/4 heuristic — good enough for budgeting, no tokenizer dependency.
 */

export type Chunk = { content: string; index: number; tokenEstimate: number };

const TARGET_CHARS = 4_000; // ~1,000 tokens
const OVERLAP_CHARS = 480; // ~120 tokens
const MIN_CHARS = 200; // don't emit trivially tiny trailing fragments alone

const estTokens = (s: string) => Math.ceil(s.length / 4);

function splitSentences(text: string): string[] {
  // Split after ., !, ? (incl. closing quote/paren) followed by whitespace.
  const parts = text.match(/[^.!?]+(?:[.!?]+["')\]]*\s+|[.!?]+["')\]]*$|$)/g);
  return (parts ?? [text]).map((s) => s.trim()).filter(Boolean);
}

/** Break a single over-long paragraph into <= TARGET_CHARS pieces at sentences. */
function splitLongParagraph(paragraph: string): string[] {
  if (paragraph.length <= TARGET_CHARS) return [paragraph];
  const out: string[] = [];
  let buf = '';
  for (const sentence of splitSentences(paragraph)) {
    if (buf && buf.length + 1 + sentence.length > TARGET_CHARS) {
      out.push(buf);
      buf = '';
    }
    if (sentence.length > TARGET_CHARS) {
      // Pathological: no sentence breaks. Hard slice.
      for (let i = 0; i < sentence.length; i += TARGET_CHARS) {
        out.push(sentence.slice(i, i + TARGET_CHARS));
      }
      continue;
    }
    buf = buf ? `${buf} ${sentence}` : sentence;
  }
  if (buf) out.push(buf);
  return out;
}

function tailOverlap(text: string): string {
  if (text.length <= OVERLAP_CHARS) return text;
  const slice = text.slice(-OVERLAP_CHARS);
  const sentences = splitSentences(slice);
  // Prefer starting the overlap at a sentence boundary.
  return sentences.length > 1 ? sentences.slice(1).join(' ') : slice;
}

export function chunkText(raw: string): Chunk[] {
  const text = (raw ?? '').trim();
  if (!text) return [];

  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, ' ').trim())
    .filter(Boolean)
    .flatMap(splitLongParagraph);

  const chunks: string[] = [];
  let buf = '';
  for (const para of paragraphs) {
    if (buf && buf.length + 2 + para.length > TARGET_CHARS) {
      chunks.push(buf);
      const overlap = tailOverlap(buf);
      buf = overlap ? `${overlap}\n\n${para}` : para;
    } else {
      buf = buf ? `${buf}\n\n${para}` : para;
    }
  }
  if (buf) {
    // Fold a tiny trailing remnant into the previous chunk instead of emitting
    // a near-empty one.
    if (chunks.length && buf.length < MIN_CHARS) {
      chunks[chunks.length - 1] = `${chunks[chunks.length - 1]}\n\n${buf}`;
    } else {
      chunks.push(buf);
    }
  }

  return chunks.map((content, index) => ({
    content,
    index,
    tokenEstimate: estTokens(content),
  }));
}
