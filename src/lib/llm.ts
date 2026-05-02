import { env } from './env';

export type AiResult = {
  summary: string;
  tags: string[];
  embedding: number[];
};

function parseJsonObject(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : {};
  }
}

async function geminiProcess(input: { text: string; tags: string[] }): Promise<AiResult> {
  if (!env.geminiApiKey) throw new Error('GEMINI_API_KEY is required');

  const prompt = [
    'You are MuttMind, an intelligence capture assistant for a creative research team.',
    'Read the source metadata and extracted text. Write a concrete, useful 2 sentence summary that says what the saved item is and why it might matter.',
    'Do not write generic marketing language. Do not speculate beyond the provided text. If the source text is thin, say what is known from the title, URL, and metadata.',
    input.tags.length
      ? `Pick tags only from this list: ${input.tags.join(', ')}.`
      : [
          'No approved tags are available.',
          'Invent 3 to 5 concise, specific tags based only on the source content and metadata.',
          'Prefer conceptual tags over domain words. Use lowercase kebab-case or short phrases.',
        ].join(' '),
    'Return only JSON with this shape: {"summary":"...","tags":["..."]}.',
    `Source content:\n${input.text}`,
  ].join('\n');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent?key=${env.geminiApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini request failed: ${response.status} ${errorText.slice(0, 180)}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{"summary":"","tags":[]}';
  const parsed = parseJsonObject(text);
  const cleanTag = (tag: string) =>
    tag
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

  const allowedTags = new Set(input.tags.map(cleanTag).filter(Boolean));
  const tags = Array.isArray(parsed.tags)
    ? parsed.tags
        .filter((tag: unknown): tag is string => typeof tag === 'string')
        .map(cleanTag)
        .filter((tag: string) => tag.length > 0)
        .filter((tag: string) => (allowedTags.size ? allowedTags.has(tag) : true))
    : [];

  return { summary: typeof parsed.summary === 'string' ? parsed.summary : '', tags, embedding: [] };
}

async function geminiEmbed(input: { text: string }): Promise<number[]> {
  if (!env.geminiApiKey) throw new Error('GEMINI_API_KEY is required');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiEmbeddingModel}:embedContent?key=${env.geminiApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: {
          parts: [{ text: input.text }],
        },
        taskType: 'SEMANTIC_SIMILARITY',
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini embedding request failed: ${response.status} ${errorText.slice(0, 180)}`);
  }

  const data = await response.json();
  const values = data?.embedding?.values;
  return Array.isArray(values) ? values.filter((value: unknown): value is number => typeof value === 'number') : [];
}

export async function aiProcess(input: { text: string; tags: string[] }): Promise<AiResult> {
  if ((process.env.LLM_PROVIDER ?? 'gemini') === 'gemini') return geminiProcess(input);
  throw new Error('Unsupported LLM provider');
}

export async function embeddingProcess(input: { text: string }): Promise<number[]> {
  if ((process.env.LLM_PROVIDER ?? 'gemini') === 'gemini') return geminiEmbed(input);
  throw new Error('Unsupported LLM provider');
}
