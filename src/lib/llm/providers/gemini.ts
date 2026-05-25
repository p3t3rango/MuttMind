import { env } from '../../env';

const TRANSIENT = new Set([429, 500, 502, 503, 504]);

/**
 * Gemini's models 503 ("high demand … usually temporary") under load.
 * Retry transient statuses with exponential backoff + jitter so brief
 * spikes self-heal instead of failing the capture's enrichment. Returns
 * the final Response either way — callers keep their own !ok handling.
 */
async function geminiFetch(
  url: string,
  init: RequestInit,
  attempts = 4,
): Promise<Response> {
  let last: Response | null = null;
  for (let i = 0; i < attempts; i += 1) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e) {
      if (i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, Math.min(8000, 500 * 2 ** i) + Math.random() * 250));
      continue;
    }
    if (res.ok || !TRANSIENT.has(res.status)) return res;
    last = res;
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, Math.min(8000, 500 * 2 ** i) + Math.random() * 250));
    }
  }
  return last as Response;
}

export type GeminiProcessInput = {
  text: string;
  tags: string[];
  model?: string;
};

export type GeminiEmbedInput = {
  text: string;
  model?: string;
};

export type GeminiGenerateTextInput = {
  prompt: string;
  systemPrompt?: string;
  model?: string;
};

export type GeminiProcessResult = {
  summary: string;
  tags: string[];
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

function cleanTag(tag: string) {
  return tag
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function geminiProcess(input: GeminiProcessInput): Promise<GeminiProcessResult> {
  if (!env.geminiApiKey) throw new Error('GEMINI_API_KEY is required');

  const approvedTags = input.tags.map((tag) => tag.trim()).filter(Boolean);
  const prompt = [
    'You are MuttMind, an intelligence capture assistant for a creative research team.',
    'Read the source metadata and extracted text like a sharp creative researcher, not a bookmark parser.',
    'If user notes are present, treat them as the reason the item was saved and use them to focus the summary and tags.',
    'Write a concrete, useful 3 sentence summary: what the saved item is, the specific themes, people, artifacts, methods, or cultural signals it contains, and why it could matter to a futurist or creative team.',
    'Do not write generic marketing language. Do not summarize only the domain name. Do not speculate beyond the provided text. If the source text is thin, explicitly say what is known and what is missing from the available metadata.',
    approvedTags.length
      ? [
          `Existing Mind tags: ${approvedTags.join(', ')}.`,
          'Use any existing tags that genuinely fit, but do not force them.',
          'Also invent additional specific tags when the source has richer concepts, practices, communities, media formats, aesthetics, technologies, or cultural signals not covered by the existing list.',
        ].join(' ')
      : [
          'No approved tags are available.',
          'Invent concise, specific tags based only on the source content and metadata.',
        ].join(' '),
    'Return 5 to 10 tags unless the source is genuinely too thin. Prefer conceptual tags over domain words, but include format tags such as tweet, video, pdf, image, portfolio, tool, event, product, or article when they fit. Use lowercase kebab-case.',
    'Avoid vague catch-all tags when a more specific tag is available. Avoid tagging only the profession or style if the source has deeper subject matter.',
    'Return only JSON with this shape: {"summary":"...","tags":["..."]}.',
    `Source content:\n${input.text}`,
  ].join('\n');

  const model = input.model ?? env.geminiModel;
  const response = await geminiFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.geminiApiKey}`,
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

  const parsedTags: string[] = Array.isArray(parsed.tags)
    ? parsed.tags
        .filter((tag: unknown): tag is string => typeof tag === 'string')
        .map(cleanTag)
        .filter((tag: string) => tag.length > 0)
    : [];
  const tags = Array.from(new Set(parsedTags)).slice(0, 10);

  return { summary: typeof parsed.summary === 'string' ? parsed.summary : '', tags };
}

export async function geminiEmbed(input: GeminiEmbedInput): Promise<number[]> {
  if (!env.geminiApiKey) throw new Error('GEMINI_API_KEY is required');

  const model = input.model ?? env.geminiEmbeddingModel;
  const response = await geminiFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${env.geminiApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text: input.text }] },
        task_type: 'SEMANTIC_SIMILARITY',
        output_dimensionality: 768,
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini embedding request failed: ${response.status} ${errorText.slice(0, 180)}`);
  }

  const data = await response.json();
  const values = data?.embedding?.values;
  return Array.isArray(values)
    ? values.filter((value: unknown): value is number => typeof value === 'number')
    : [];
}

export async function geminiGenerateText(input: GeminiGenerateTextInput): Promise<string> {
  if (!env.geminiApiKey) throw new Error('GEMINI_API_KEY is required');

  const model = input.model ?? env.geminiModel;
  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: input.prompt }] }],
  };
  if (input.systemPrompt) {
    body.system_instruction = { parts: [{ text: input.systemPrompt }] };
  }

  const response = await geminiFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.geminiApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini text request failed: ${response.status} ${errorText.slice(0, 180)}`);
  }

  const data = await response.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

/**
 * Streaming variant of geminiGenerateText. Calls streamGenerateContent with
 * SSE and yields text deltas as they arrive. Reuses geminiFetch for the
 * initial connection (retry/backoff), then reads the SSE body manually.
 */
export async function* geminiGenerateTextStream(
  input: GeminiGenerateTextInput,
): AsyncGenerator<string> {
  if (!env.geminiApiKey) throw new Error('GEMINI_API_KEY is required');
  const model = input.model ?? env.geminiModel;
  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: input.prompt }] }],
  };
  if (input.systemPrompt) body.system_instruction = { parts: [{ text: input.systemPrompt }] };

  const response = await geminiFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${env.geminiApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok || !response.body) {
    const errorText = response.body ? await response.text() : '';
    throw new Error(`Gemini stream failed: ${response.status} ${errorText.slice(0, 180)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // Assumption: Gemini SSE emits one `data: {json}` per line (no multi-line
  // data blocks), so newline-splitting is sufficient. If Gemini ever changes
  // framing to multi-line SSE events, switch to splitting on '\n\n'.
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const json = trimmed.slice(5).trim();
      if (!json || json === '[DONE]') continue;
      try {
        const parsed = JSON.parse(json);
        const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text === 'string' && text) yield text;
      } catch {
        // partial JSON across chunks — ignore; the next read completes it
      }
    }
  }
}

export type GeminiTranscribeInput = {
  base64: string;
  mimeType: string;
  model?: string;
};

export async function geminiTranscribe(input: GeminiTranscribeInput): Promise<string> {
  if (!env.geminiApiKey) throw new Error('GEMINI_API_KEY is required');
  const model = input.model ?? env.geminiModel;
  const response = await geminiFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.geminiApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inline_data: { mime_type: input.mimeType, data: input.base64 } },
              {
                text: 'Transcribe this audio verbatim into clean readable text. Return only the transcript — no preamble, no timestamps, no speaker labels unless multiple speakers are clearly distinct.',
              },
            ],
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini transcription failed: ${response.status} ${errorText.slice(0, 180)}`);
  }
  const data = await response.json();
  return (data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
}
