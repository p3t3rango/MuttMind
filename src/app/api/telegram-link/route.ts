import { requireUserId } from '@/lib/auth';
import { createTelegramStartUrl } from '@/lib/telegram-link';

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    return Response.json({ url: await createTelegramStartUrl(userId) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 400 });
  }
}
