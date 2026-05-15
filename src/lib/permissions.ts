import { getSupabaseAdmin } from './supabase';

export type PermissionKey = 'manage_spaces' | 'manage_voice' | 'manage_members';

const PRIVILEGED_ROLES = new Set(['owner', 'admin']);

async function getMemberRole(workspaceId: string, userId: string): Promise<string | null> {
  const { data } = await getSupabaseAdmin()
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  return data?.role ?? null;
}

export async function userCan(
  userId: string,
  workspaceId: string,
  permissionKey: PermissionKey,
): Promise<boolean> {
  const role = await getMemberRole(workspaceId, userId);
  if (!role) return false;
  if (PRIVILEGED_ROLES.has(role)) return true;

  const { data } = await getSupabaseAdmin()
    .from('workspace_member_permissions')
    .select('permission_key')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('permission_key', permissionKey)
    .maybeSingle();
  return Boolean(data);
}

export async function getUserPermissions(
  userId: string,
  workspaceId: string,
): Promise<{ role: string | null; permissions: PermissionKey[]; isAdmin: boolean }> {
  const role = await getMemberRole(workspaceId, userId);
  if (!role) return { role: null, permissions: [], isAdmin: false };

  const { data } = await getSupabaseAdmin()
    .from('workspace_member_permissions')
    .select('permission_key')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId);

  const permissions = (data ?? [])
    .map((row) => row.permission_key as PermissionKey)
    .filter((key): key is PermissionKey => Boolean(key));

  return { role, permissions, isAdmin: PRIVILEGED_ROLES.has(role) };
}

export async function assertCan(
  userId: string,
  workspaceId: string,
  permissionKey: PermissionKey,
): Promise<void> {
  const allowed = await userCan(userId, workspaceId, permissionKey);
  if (!allowed) throw new Error(`Missing permission: ${permissionKey}`);
}
