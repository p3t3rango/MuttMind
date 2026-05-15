/**
 * Per-capture Insight Lenses (Feature 3.8).
 *
 * Each lens is a fixed prompt template applied to a single capture. The
 * lenses are deliberately small in number — additive over time, but the
 * core set captures the most-used interpretive frames.
 *
 * Same source viewed through many frames = berrypicking made literal.
 */

export type LensKey =
  | 'gist'
  | 'eli5'
  | 'contrarian'
  | 'analogy'
  | 'hot-take'
  | 'why-saved'
  | 'whats-missing';

export type LensDefinition = {
  key: LensKey;
  label: string;
  description: string;
  /** Builds the user prompt fragment given the capture's context. */
  prompt: (input: LensPromptInput) => string;
};

export type LensPromptInput = {
  title: string | null;
  url: string | null;
  summary: string | null;
  description: string | null;
  rawText: string | null;
  userNotes: string | null;
  mindName: string;
  mindSystemPromptExcerpt?: string | null;
};

function captureContext(input: LensPromptInput): string {
  const lines: string[] = [];
  if (input.title) lines.push(`Title: ${input.title}`);
  if (input.url) lines.push(`URL: ${input.url}`);
  if (input.summary) lines.push(`Existing summary: ${input.summary}`);
  else if (input.description) lines.push(`Description: ${input.description}`);
  if (input.userNotes) lines.push(`User notes: ${input.userNotes}`);
  if (input.rawText && input.rawText.length > 0) {
    lines.push(`Source excerpt:\n${input.rawText.slice(0, 2400)}`);
  }
  return lines.filter(Boolean).join('\n');
}

export const LENSES: LensDefinition[] = [
  {
    key: 'gist',
    label: 'The Gist',
    description: 'A one-paragraph essence — what it actually says.',
    prompt: (input) =>
      `Read this capture and write a single tight paragraph (about 80 words) that distills its essence. Concrete, specific, no generic openers. If the source is thin, say so plainly.\n\n${captureContext(input)}`,
  },
  {
    key: 'eli5',
    label: 'Explain Like I\'m 5',
    description: 'Plain-language re-explanation.',
    prompt: (input) =>
      `Re-explain this capture for a smart twelve-year-old. No jargon. Use a concrete example or two. About 120 words.\n\n${captureContext(input)}`,
  },
  {
    key: 'contrarian',
    label: 'Contrarian Take',
    description: 'Steelman the opposite — what would a thoughtful skeptic say?',
    prompt: (input) =>
      `Steelman the opposite of the position taken in this capture. What would a thoughtful skeptic say? Argue it as if you held the view, not as a strawman. About 150 words.\n\n${captureContext(input)}`,
  },
  {
    key: 'analogy',
    label: 'Analogy',
    description: 'A non-obvious analogy that makes the idea click.',
    prompt: (input) =>
      `Find a non-obvious analogy that makes the central idea of this capture click. Set it up in two sentences and then state the analogy in one. Avoid the most predictable framings.\n\n${captureContext(input)}`,
  },
  {
    key: 'hot-take',
    label: 'Hot Take',
    description: 'A punchy, opinionated, one-line take.',
    prompt: (input) =>
      `Write a punchy, opinionated, one-line hot take on this capture. Tweet length. Have a real position — no hedging.\n\n${captureContext(input)}`,
  },
  {
    key: 'why-saved',
    label: 'Why I might have saved this',
    description: 'Inferred relevance to this Mind\'s focus.',
    prompt: (input) => {
      const stance = input.mindSystemPromptExcerpt
        ? `\n\nThe Mind's stance:\n${input.mindSystemPromptExcerpt.slice(0, 800)}`
        : '';
      return `Given the focus and stance of the Mind called "${input.mindName}", infer why the user likely saved this capture. What thread does it pull on? Be specific. About 120 words.${stance}\n\n${captureContext(input)}`;
    },
  },
  {
    key: 'whats-missing',
    label: 'What\'s missing',
    description: 'What this source doesn\'t address that the Mind would want.',
    prompt: (input) =>
      `Looking at this capture in the context of the Mind called "${input.mindName}", what does this source NOT address that the Mind would care about? Be honest about gaps — don't pad. Three short bullets.\n\n${captureContext(input)}`,
  },
];

export function lensByKey(key: string): LensDefinition | undefined {
  return LENSES.find((l) => l.key === key);
}
