import { captureSignal } from '@/lib/capture';
import { createTelegramConnectUrl, parseTelegramStartPayload } from '@/lib/telegram-link';
import {
  createTelegramWorkspace,
  findTelegramWorkspace,
  formatTelegramHelp,
  formatWorkspaceList,
  getActiveTelegramWorkspace,
  getTelegramUser,
  isTelegramSecretValid,
  linkTelegramUser,
  listTelegramWorkspaces,
  sendTelegramMessage,
  setActiveTelegramWorkspace,
  unlinkTelegramUser,
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

  const trimmedText = text.trim();
  const command = trimmedText.split(/\s+/)[0].toLowerCase();
  const commandName = command.replace(/@\w+$/, '');
  let user = await getTelegramUser(telegramUserId);

  if (commandName === '/start') {
    const payload = trimmedText.replace(/^\/start(@\w+)?\s*/i, '').trim();
    const parsedPayload = payload ? parseTelegramStartPayload(payload) : null;

    if (parsedPayload) {
      try {
        user = await linkTelegramUser(telegramUserId, parsedPayload.userId);
        await sendTelegramMessage(
          chatId,
          `Telegram connected to ${user.display_name || user.email || 'your MuttMind account'}.\n\nSend /minds to choose a Mind, or paste a link to capture.`,
        );
        return Response.json({ ok: true, command, linked: true });
      } catch (e) {
        await sendTelegramMessage(chatId, e instanceof Error ? e.message : 'Unable to link this Telegram account.');
        return Response.json({ ok: true, ignored: true, reason: 'telegram link failed' });
      }
    }
  }

  if (!user) {
    const connectUrl = createTelegramConnectUrl(new URL(req.url).origin, telegramUserId, chatId);
    await sendTelegramMessage(
      chatId,
      [
        'This Telegram account is not linked to MuttMind yet.',
        '',
        'Open this link, sign in, and I will connect this Telegram chat to that account:',
        connectUrl,
        '',
        'The link expires in 15 minutes. You can also sign in to MuttMind and click Open Bot from the Mind screen or Settings.',
      ].join('\n'),
    );
    return Response.json({ ok: true, ignored: true, reason: 'telegram user not linked' });
  }

  const workspaces = await listTelegramWorkspaces(user.id);

  try {
    if (commandName === '/start' || commandName === '/help') {
      const activeWorkspace = await getActiveTelegramWorkspace(telegramUserId, user.id);
      await sendTelegramMessage(chatId, formatTelegramHelp(workspaces, activeWorkspace));
      return Response.json({ ok: true, command });
    }

    if (commandName === '/workspaces' || commandName === '/minds') {
      await sendTelegramMessage(chatId, formatWorkspaceList(workspaces));
      return Response.json({ ok: true, command });
    }

    if (commandName === '/unlink') {
      await unlinkTelegramUser(telegramUserId);
      const connectUrl = createTelegramConnectUrl(new URL(req.url).origin, telegramUserId, chatId);
      await sendTelegramMessage(
        chatId,
        [
          'Telegram disconnected from MuttMind.',
          '',
          'To connect a different account, open this link and sign in:',
          connectUrl,
        ].join('\n'),
      );
      return Response.json({ ok: true, command, unlinked: true });
    }

    if (commandName === '/new' || commandName === '/newmind') {
      const name = trimmedText.replace(/^\/(?:new|newmind)(@\w+)?\s*/i, '').trim();
      if (!name) {
        await sendTelegramMessage(chatId, 'Send /new followed by a Mind name.\n\nExample: /new Research Inbox');
        return Response.json({ ok: true, command, missingName: true });
      }

      const workspace = await createTelegramWorkspace(user.id, name);
      await setActiveTelegramWorkspace(telegramUserId, user.id, workspace.id);
      await sendTelegramMessage(
        chatId,
        `Created ${workspace.name} and made it your active Mind.\n\nNow send any URL and I will capture it there.`,
      );
      return Response.json({ ok: true, command, workspaceId: workspace.id });
    }

    if (commandName === '/current') {
      const activeWorkspace = await getActiveTelegramWorkspace(telegramUserId, user.id);
      await sendTelegramMessage(
        chatId,
        activeWorkspace
          ? `Active Mind: ${activeWorkspace.name}\n\nSend any URL and I will capture it there.`
          : `No active Mind selected yet.\n\n${formatWorkspaceList(workspaces)}`,
      );
      return Response.json({ ok: true, command });
    }

    if (commandName === '/use') {
      const query = trimmedText.replace(/^\/use(@\w+)?\s*/i, '').trim();
      if (!query) {
        await sendTelegramMessage(chatId, `Send /use followed by a Mind name or number.\n\n${formatWorkspaceList(workspaces)}`);
        return Response.json({ ok: true, command, missingQuery: true });
      }

      const workspace = findTelegramWorkspace(query, workspaces);

      if (!workspace) {
        await sendTelegramMessage(
          chatId,
          `I could not find that Mind. Use the number or the name.\n\n${formatWorkspaceList(workspaces)}`,
        );
        return Response.json({ ok: true, command, notFound: true });
      }

      await setActiveTelegramWorkspace(telegramUserId, user.id, workspace.id);
      await sendTelegramMessage(
        chatId,
        `Active Mind set to ${workspace.name}.\n\nNow send any URL and I will capture it there.`,
      );
      return Response.json({ ok: true, command, workspaceId: workspace.id });
    }

    const explicitWorkspaceId = trimmedText.match(/workspace:([a-f0-9-]{36})/i)?.[1];
    const url = trimmedText.match(/https?:\/\/\S+/)?.[0];

    if (!url) {
      await sendTelegramMessage(
        chatId,
        'Send a URL to capture, /minds to list Minds, /new <Mind name> to create one, or /use <Mind> to choose one.',
      );
      return Response.json({ ok: true, ignored: true, reason: 'no url' });
    }

    let activeWorkspace = explicitWorkspaceId
      ? workspaces.find((workspace) => workspace.id === explicitWorkspaceId)
      : await getActiveTelegramWorkspace(telegramUserId, user.id);

    if (!activeWorkspace && workspaces.length === 1) {
      activeWorkspace = workspaces[0];
      await setActiveTelegramWorkspace(telegramUserId, user.id, activeWorkspace.id);
    }

    if (!activeWorkspace) {
      await sendTelegramMessage(
        chatId,
        `Choose a Mind first with /use <name or number>.\n\n${formatWorkspaceList(workspaces)}`,
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
      `Saved to ${activeWorkspace.name}.\nI am adding the summary, tags, and relationship map links now.`,
    );

    return Response.json({ ok: true, nodeId: result.nodeId });
  } catch (e) {
    await sendTelegramMessage(chatId, `MuttMind could not capture that: ${e instanceof Error ? e.message : 'unknown error'}`);
    return Response.json({ error: e instanceof Error ? e.message : 'unknown' }, { status: 400 });
  }
}
