function normalizeGeminiModel(value: string | undefined, fallback: string) {
  const model = value?.trim().replace(/^models\//, '') ?? '';
  return model || fallback;
}

function normalizeGeminiEmbeddingModel(value: string | undefined) {
  const model = normalizeGeminiModel(value, 'gemini-embedding-001');
  const legacyUnsupported = new Set(['text-embedding-004', 'embedding-001']);
  return legacyUnsupported.has(model) ? 'gemini-embedding-001' : model;
}

export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: normalizeGeminiModel(process.env.GEMINI_MODEL, 'gemini-2.5-flash'),
  geminiEmbeddingModel: normalizeGeminiEmbeddingModel(process.env.GEMINI_EMBEDDING_MODEL ?? process.env.EMBEDDING_MODEL),
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
  xBearerToken: process.env.X_BEARER_TOKEN ?? '',
  // LLM-cost feature flags. Default OFF — set to '1' to enable. Synthesis,
  // lenses, and Q&A all stay dormant unless explicitly enabled, so the
  // scaffolding can ship without burning tokens.
  synthesisEnabled: process.env.MUTTMIND_SYNTHESIS_ENABLED === '1',
  lensesEnabled: process.env.MUTTMIND_LENSES_ENABLED === '1',
  askEnabled: process.env.MUTTMIND_ASK_ENABLED === '1',
  digestEnabled: process.env.MUTTMIND_DIGEST_ENABLED === '1',
  // Stage 2: per-passage chunk embeddings at capture. Default OFF — flip to '1'
  // before re-capturing so each node also gets node_chunks for retrieval.
  chunkingEnabled: process.env.MUTTMIND_CHUNKING_ENABLED === '1',
  // Voice-memo transcription via Gemini. LLM cost — default OFF.
  voiceEnabled: process.env.MUTTMIND_VOICE_ENABLED === '1',
  cronSecret: process.env.CRON_SECRET ?? '',
};
