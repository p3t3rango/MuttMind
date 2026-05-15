-- =============================================================================
-- Rename permission key: manage_spaces -> manage_mind
-- =============================================================================
-- The original key was named during the brief Spaces era. Now that the Mind
-- IS the unit, the key gates editing Mind-level configuration (system prompt,
-- model, etc.), so the name should match.
--
-- Apply in Supabase SQL editor. ROLLBACK at the bottom.
-- =============================================================================

-- Drop the old CHECK constraint (named by Postgres' default convention).
alter table public.workspace_member_permissions
  drop constraint if exists workspace_member_permissions_permission_key_check;

-- Rename any existing rows. Likely none yet; safe either way.
update public.workspace_member_permissions
  set permission_key = 'manage_mind'
  where permission_key = 'manage_spaces';

-- Re-add the CHECK constraint with the new enum.
alter table public.workspace_member_permissions
  add constraint workspace_member_permissions_permission_key_check
  check (permission_key in ('manage_mind', 'manage_voice', 'manage_members'));

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- alter table public.workspace_member_permissions
--   drop constraint if exists workspace_member_permissions_permission_key_check;
-- update public.workspace_member_permissions
--   set permission_key = 'manage_spaces'
--   where permission_key = 'manage_mind';
-- alter table public.workspace_member_permissions
--   add constraint workspace_member_permissions_permission_key_check
--   check (permission_key in ('manage_spaces', 'manage_voice', 'manage_members'));
