import { requireUserId } from '@/lib/auth';
import { generateText } from '@/lib/llm';
import { buildMetaPrompt } from '@/lib/spaces-prompts';
import { assertWorkspaceMember } from '@/lib/workspace';

/**
 * Generate a draft system prompt for a new Space from the user's onboarding
 * answers. The result is shown to the user for editing before save — this
 * endpoint never writes to the database.
 */
export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const body = await req.json();
    const { workspaceId, name, purpose, primer, provider, model } = body ?? {};

    if (!workspaceId) return Response.json({ error: 'workspaceId required' }, { status: 400 });
    if (typeof name !== 'string' || !name.trim()) {
      return Response.json({ error: 'name required' }, { status: 400 });
    }

    await assertWorkspaceMember(workspaceId, userId);

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
    const status = message.includes('Not a workspace member') ? 403 : 500;
    return Response.json({ error: message }, { status });
  }
}
