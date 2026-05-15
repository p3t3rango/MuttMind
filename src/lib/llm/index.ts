import { geminiEmbed, geminiGenerateText, geminiProcess } from './providers/gemini';

export type LlmProvider = 'gemini';

export type AiResult = {
  summary: string;
  tags: string[];
  embedding: number[];
};

export type AiProcessInput = {
  text: string;
  tags: string[];
  provider?: LlmProvider;
  model?: string;
};

export type EmbeddingProcessInput = {
  text: string;
  provider?: LlmProvider;
  model?: string;
};

export type GenerateTextInput = {
  prompt: string;
  systemPrompt?: string;
  provider?: LlmProvider;
  model?: string;
};

function resolveProvider(provider?: LlmProvider): LlmProvider {
  return provider ?? ((process.env.LLM_PROVIDER as LlmProvider | undefined) ?? 'gemini');
}

export async function aiProcess(input: AiProcessInput): Promise<AiResult> {
  const provider = resolveProvider(input.provider);
  switch (provider) {
    case 'gemini': {
      const result = await geminiProcess({ text: input.text, tags: input.tags, model: input.model });
      return { summary: result.summary, tags: result.tags, embedding: [] };
    }
    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}

export async function embeddingProcess(input: EmbeddingProcessInput): Promise<number[]> {
  const provider = resolveProvider(input.provider);
  switch (provider) {
    case 'gemini':
      return geminiEmbed({ text: input.text, model: input.model });
    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}

export async function generateText(input: GenerateTextInput): Promise<string> {
  const provider = resolveProvider(input.provider);
  switch (provider) {
    case 'gemini':
      return geminiGenerateText({
        prompt: input.prompt,
        systemPrompt: input.systemPrompt,
        model: input.model,
      });
    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}
