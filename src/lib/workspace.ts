import { supabaseAdmin } from './supabase';
export async function assertWorkspaceMember(workspaceId: string, userId: string) { const { data } = await supabaseAdmin.from('workspace_members').select('role').eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle(); if (!data) throw new Error('Not a workspace member'); return data.role; }
export async function resolveTelegramToUser(telegramUserId: number): Promise<string | null> { const { data } = await supabaseAdmin.from('users').select('id').eq('telegram_user_id', telegramUserId).maybeSingle(); return data?.id ?? null; }
