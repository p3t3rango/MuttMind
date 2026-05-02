import { captureSignal } from '@/lib/capture';
import {
  formatWorkspaceList,
  getActiveTelegramWorkspace,
  getTelegramUser,
  isTelegramSecretValid,
  listTelegramWorkspaces,
  sendTelegramMessage,
  setActiveTelegramWorkspace,
} from '@/lib/telegram';

export async function POST(req: Request) {
  const secret = req.headers.get('x-telegram-bot-api-secret-token');
  if (!isTelegramSecretValid(secret)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const telegramUserId = body?.message?.from?.id as number | undefined;
  const chatId = body?.message?.chat?.id as number | undefined;
  const text = body?.message?.text as string | undefined;

  if (!telegramUserId || !chatId || !text) {
    return Response.json({ ok: true, ignored: true });
  }

  const user = await getTelegramUser(telegramUserId);
  if (!user) {
    await sendTelegramMessage(
      chatId,
      `This Telegram account is not linked to MuttMind yet.\n\nYour Telegram ID is ${telegramUserId}. Add it to your MuttMind user profile to continue.`,
    );
    return Response.json({ ok: true, ignored: true, reason: 'telegram user not linked' });
  }

  const trimmedText = text.trim();
  const command = trimmedText.split(/\s+/)[0].toLowerCase();
  const workspaces = await listTelegramWorkspaces(user.id);

  try {
    if (command === '/start' || command === '/workspaces') {
      await sendTelegramMessage(chatId, formatWorkspaceList(workspaces));
      return Response.json({ ok: true, command });
    }

    if (command === '/use') {
      const query = trimmedText.replace(/^\/use(@\w+)?\s*/i, '').trim();
      if (!query) {
        await sendTelegramMessage(chatId, 'Send /use followed by a workspace name or UUID.');
        return Response.json({ ok: true, command, missingQuery: true });
      }

      const workspace =
        workspaces.find((item) => item.id.toLowerCase() === query.toLowerCase()) ??
        workspaces.find((item) => item.name.toLowerCase() === query.toLowerCase());

      if (!workspace) {
        await sendTelegramMessage(
          chatId,
          `I could not find that workspace.\n\n${formatWorkspaceList(workspaces)}`,
        );
        return Response.json({ ok: true, command, notFound: true });
      }

      await setActiveTelegramWorkspace(telegramUserId, user.id, workspace.id);
      await sendTelegramMessage(
        chatId,
        `Active workspace set to ${workspace.name}.\n\nNow send any URL and I will capture it there.`,
      );
      return Response.json({ ok: true, command, workspaceId: workspace.id });
    }

    const explicitWorkspaceId = trimmedText.match(/workspace:([a-f0-9-]{36})/i)?.[1];
    const url = trimmedText.match(/https?:\/\/\S+/)?.[0];

    if (!url) {
      await sendTelegramMessage(
        chatId,
        'Send a URL to capture, /workspaces to list workspaces, or /use <workspace> to choose one.',
      );
      return Response.json({ ok: true, ignored: true, reason: 'no url' });
    }

    const activeWorkspace = explicitWorkspaceId
      ? workspaces.find((workspace) => workspace.id === explicitWorkspaceId)
      : await getActiveTelegramWorkspace(telegramUserId, user.id);

    if (!activeWorkspace) {
      await sendTelegramMessage(
        chatId,
        `Choose a workspace first.\n\n${formatWorkspaceList(workspaces)}`,
      );
      return Response.json({ ok: true, ignored: true, reason: 'no active workspace' });
    }

    const result = await captureSignal({
      userId: user.id,
      workspaceId: activeWorkspace.id,
      url,
      rawText: trimmedText,
    });

    await sendTelegramMessage(
      chatId,
      `Saved to ${activeWorkspace.name}.\nI added a summary, tags, and map links when available.`,
    );

    return Response.json({ ok: true, nodeId: result.nodeId });
  } catch (e) {
    await sendTelegramMessage(chatId, `MuttMind could not capture that: ${e instanceof Error ? e.message : 'unknown error'}`);
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 400 });
  }
}
