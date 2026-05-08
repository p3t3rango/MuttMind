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
    .select('id,email,display_name')
    .eq('telegram_user_id', telegramUserId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

export async function linkTelegramUser(telegramUserId: number, userId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from('users')
    .update({ telegram_user_id: telegramUserId })
    .eq('id', userId)
    .select('id,email,display_name')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('This Telegram account is already linked to another MuttMind account.');
    }
    throw new Error(error.message);
  }

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

export async function createTelegramWorkspace(userId: string, name: string): Promise<TelegramWorkspace> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error('Mind name required.');
  }

  const { data: workspace, error } = await getSupabaseAdmin()
    .from('workspaces')
    .insert({ name: trimmedName, created_by: userId })
    .select('id,name')
    .single();

  if (error) throw new Error(error.message);

  const { error: memberError } = await getSupabaseAdmin()
    .from('workspace_members')
    .insert({ workspace_id: workspace.id, user_id: userId, role: 'owner' });

  if (memberError) throw new Error(memberError.message);

  return { id: workspace.id, name: workspace.name, role: 'owner' };
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
    return 'No Minds found. Create one with /new <Mind name>.';
  }

  return [
    'Your MuttMind Minds:',
    ...workspaces.map(
      (workspace, index) =>
        `${index + 1}. ${workspace.name} (${workspace.role})\n/use ${index + 1} or /use ${workspace.name}`,
    ),
    '',
    'After selecting one, send any URL and I will capture it there.',
  ].join('\n');
}

export function formatTelegramHelp(workspaces: TelegramWorkspace[], activeWorkspace?: TelegramWorkspace | null) {
  return [
    'Welcome to MuttMind.',
    '',
    'Send me a link and I will save it to your active Mind, then generate a summary, tags, and map connections.',
    '',
    activeWorkspace ? `Active Mind: ${activeWorkspace.name}` : 'No active Mind selected yet.',
    '',
    'Commands:',
    '/help - show these instructions',
    '/minds - list your Minds',
    '/new <Mind name> - create a new Mind',
    '/use <name or number> - choose where links save',
    '/current - show the active Mind',
    '',
    workspaces.length ? formatWorkspaceList(workspaces) : 'Create a Mind with /new <Mind name>.',
  ].join('\n');
}

export function findTelegramWorkspace(query: string, workspaces: TelegramWorkspace[]) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return null;

  const numericIndex = Number.parseInt(normalizedQuery, 10);
  if (Number.isInteger(numericIndex) && numericIndex >= 1 && numericIndex <= workspaces.length) {
    return workspaces[numericIndex - 1];
  }

  return (
    workspaces.find((item) => item.id.toLowerCase() === normalizedQuery) ??
    workspaces.find((item) => item.name.toLowerCase() === normalizedQuery) ??
    (() => {
      const matches = workspaces.filter((item) => item.name.toLowerCase().includes(normalizedQuery));
      return matches.length === 1 ? matches[0] : null;
    })()
  );
}

export function isTelegramSecretValid(secret: string | null) {
  return Boolean(env.telegramWebhookSecret && secret === env.telegramWebhookSecret);
}
