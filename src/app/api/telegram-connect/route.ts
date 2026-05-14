import { requireUserId } from '@/lib/auth';
import { getTelegramBotUrl, parseTelegramConnectToken } from '@/lib/telegram-link';
import { linkTelegramUser, sendTelegramMessage } from '@/lib/telegram';

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const { token } = await req.json();
    const parsed = parseTelegramConnectToken(String(token ?? ''));

    if (!parsed) {
      return Response.json({ error: 'This Telegram connect link is invalid or expired.' }, { status: 400 });
    }

    const user = await linkTelegramUser(parsed.telegramUserId, userId);
    const label = user.display_name || user.email || 'your MuttMind account';
    await sendTelegramMessage(
      parsed.chatId,
      `Telegram connected to ${label}.\n\nSend /minds to choose a Mind, /new to create one, or paste a link to capture.`,
    );

    return Response.json({
      ok: true,
      user: {
        email: user.email,
        display_name: user.display_name,
      },
      botUrl: await getTelegramBotUrl(),
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 401 });
  }
}
