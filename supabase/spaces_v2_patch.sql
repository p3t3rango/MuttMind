-- =============================================================================
-- Spaces v2 + Permissions migration
-- =============================================================================
-- Adds per-Space system prompt, voice configuration, mode_type, provider/model.
-- Adds Mind-level defaults on workspaces.
-- Introduces workspace_member_permissions for delegated privileges.
--
-- Apply in Supabase SQL editor. ROLLBACK at the bottom if you need to undo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- smart_spaces: per-Space configuration
-- -----------------------------------------------------------------------------
alter table public.smart_spaces
  add column if not exists system_prompt text,
  add column if not exists voice_source text not null default 'system_prompt'
    check (voice_source in ('system_prompt', 'user_notes', 'mind_notes')),
  add column if not exists voice_user_ids uuid[] not null default '{}',
  add column if not exists mode_type text not null default 'query'
    check (mode_type in ('query', 'steep', 'voice', 'neighborhood', 'all')),
  add column if not exists seed_node_id uuid references public.nodes(id) on delete set null,
  add column if not exists seed_tag_id uuid references public.tags(id) on delete set null,
  add column if not exists seed_author text,
  add column if not exists provider text not null default 'gemini',
  add column if not exists model text;

-- -----------------------------------------------------------------------------
-- workspaces: Mind-level defaults inherited by Spaces
-- -----------------------------------------------------------------------------
alter table public.workspaces
  add column if not exists default_system_prompt text,
  add column if not exists default_provider text not null default 'gemini',
  add column if not exists default_model text;

-- -----------------------------------------------------------------------------
-- workspace_member_permissions: delegated privileges
-- -----------------------------------------------------------------------------
create table if not exists public.workspace_member_permissions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  permission_key text not null
    check (permission_key in ('manage_spaces', 'manage_voice', 'manage_members')),
  granted_by uuid not null references public.users(id) on delete restrict,
  granted_at timestamptz not null default now(),
  primary key (workspace_id, user_id, permission_key)
);

create index if not exists workspace_member_permissions_user_workspace_idx
  on public.workspace_member_permissions(user_id, workspace_id);

alter table public.workspace_member_permissions enable row level security;

-- Members of a workspace can see all permission grants in it (so admins can audit,
-- and members can see what they themselves have been granted).
drop policy if exists "Workspace members can read permission grants"
  on public.workspace_member_permissions;
create policy "Workspace members can read permission grants"
on public.workspace_member_permissions for select
to authenticated
using (private.is_workspace_member(workspace_id));

-- Only admins can grant permissions.
drop policy if exists "Workspace admins can grant permissions"
  on public.workspace_member_permissions;
create policy "Workspace admins can grant permissions"
on public.workspace_member_permissions for insert
to authenticated
with check (
  private.is_workspace_admin(workspace_id)
  and (select auth.uid()) = granted_by
);

-- Only admins can revoke permissions.
drop policy if exists "Workspace admins can revoke permissions"
  on public.workspace_member_permissions;
create policy "Workspace admins can revoke permissions"
on public.workspace_member_permissions for delete
to authenticated
using (private.is_workspace_admin(workspace_id));

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- Run this section ONLY if you want to undo the migration above.
-- Drops permission grants, removes new columns, restores prior shape.
-- =============================================================================
--
-- drop table if exists public.workspace_member_permissions;
--
-- alter table public.workspaces
--   drop column if exists default_system_prompt,
--   drop column if exists default_provider,
--   drop column if exists default_model;
--
-- alter table public.smart_spaces
--   drop column if exists system_prompt,
--   drop column if exists voice_source,
--   drop column if exists voice_user_ids,
--   drop column if exists mode_type,
--   drop column if exists seed_node_id,
--   drop column if exists seed_tag_id,
--   drop column if exists seed_author,
--   drop column if exists provider,
--   drop column if exists model;
