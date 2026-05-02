import { env } from './env';
import { getSupabaseAdmin } from './supabase';

export type TelegramWorkspace = {
  id: string;
  name: string;
  role: string;
};

export async function sendTelegramMessage(chatId: number, text: string) {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.log('telegram reply skipped: TELEGRAM_BOT_TOKEN is not set');
    return;
  }

  const response = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    },
  );

  if (!response.ok) {
    console.log('telegram reply failed', { status: response.status });
  }
}

export async function getTelegramUser(telegramUserId: number) {
  const { data, error } = await getSupabaseAdmin()
    .from('users')
    .select('id,email')
    .eq('telegram_user_id', telegramUserId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

export async function listTelegramWorkspaces(userId: string): Promise<TelegramWorkspace[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('workspace_members')
    .select('role, workspaces(id,name)')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? [])
    .map((row) => {
      const workspace = Array.isArray(row.workspaces) ? row.workspaces[0] : row.workspaces;
      return workspace
        ? { id: workspace.id, name: workspace.name, role: row.role }
        : null;
    })
    .filter((workspace): workspace is TelegramWorkspace => Boolean(workspace));
}

export async function getActiveTelegramWorkspace(telegramUserId: number, userId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from('telegram_sessions')
    .select('active_workspace_id')
    .eq('telegram_user_id', telegramUserId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.active_workspace_id) return null;

  const workspaces = await listTelegramWorkspaces(userId);
  return workspaces.find((workspace) => workspace.id === data.active_workspace_id) ?? null;
}

export async function setActiveTelegramWorkspace(
  telegramUserId: number,
  userId: string,
  workspaceId: string,
) {
  const { error } = await getSupabaseAdmin().from('telegram_sessions').upsert({
    telegram_user_id: telegramUserId,
    user_id: userId,
    active_workspace_id: workspaceId,
  });

  if (error) throw new Error(error.message);
}

export function formatWorkspaceList(workspaces: TelegramWorkspace[]) {
  if (!workspaces.length) {
    return 'No Minds found. Create one in MuttMind first, then come back here.';
  }

  return [
    'Your MuttMind Minds:',
    ...workspaces.map(
      (workspace, index) =>
        `${index + 1}. ${workspace.name} (${workspace.role})\n/use ${workspace.id}`,
    ),
    '',
    'After selecting one, send any URL and I will capture it there.',
  ].join('\n');
}

export function isTelegramSecretValid(secret: string | null) {
  return Boolean(env.telegramWebhookSecret && secret === env.telegramWebhookSecret);
}
