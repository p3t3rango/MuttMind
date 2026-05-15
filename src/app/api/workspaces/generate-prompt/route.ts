import { requireUserId } from '@/lib/auth';
import { generateText } from '@/lib/llm';
import { buildMetaPrompt } from '@/lib/minds-prompts';

/**
 * Generate a draft system prompt for a new Mind from the user's onboarding
 * answers. The result is shown to the user for editing before save — this
 * endpoint never writes to the database.
 *
 * Note: this runs BEFORE the Mind exists (during onboarding), so there's no
 * workspaceId to assert membership against. We only require an authenticated
 * user.
 */
export async function POST(req: Request) {
  try {
    await requireUserId(req);
    const body = await req.json();
    const { name, purpose, primer, provider, model } = body ?? {};

    if (typeof name !== 'string' || !name.trim()) {
      return Response.json({ error: 'name required' }, { status: 400 });
    }

    const metaPrompt = buildMetaPrompt({
      name: name.trim(),
      purpose: typeof purpose === 'string' ? purpose : undefined,
      primer: typeof primer === 'string' ? primer : undefined,
    });

    const draft = await generateText({
      prompt: metaPrompt,
      provider: provider === 'gemini' ? 'gemini' : undefined,
      model: typeof model === 'string' && model.trim() ? model.trim() : undefined,
    });

    return Response.json({ systemPrompt: draft.trim() });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown';
    return Response.json({ error: message }, { status: 500 });
  }
}
