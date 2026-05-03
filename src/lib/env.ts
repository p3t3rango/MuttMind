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
};
