create extension if not exists pgcrypto;

create table if not exists public.smart_spaces (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references public.users(id) on delete restrict,
  name text not null check (char_length(trim(name)) > 0),
  query text not null check (char_length(trim(query)) > 0),
  color text not null default '#7c3aed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references public.users(id) on delete restrict,
  email text,
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  role text not null default 'member' check (role in ('admin', 'member')),
  accepted_by uuid references public.users(id) on delete set null,
  accepted_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists smart_spaces_workspace_created_at_idx on public.smart_spaces(workspace_id, created_at desc);
create index if not exists workspace_invites_workspace_created_at_idx on public.workspace_invites(workspace_id, created_at desc);
create index if not exists workspace_invites_email_idx on public.workspace_invites(lower(email));
create index if not exists workspace_invites_token_idx on public.workspace_invites(token);

drop trigger if exists set_smart_spaces_updated_at on public.smart_spaces;
create trigger set_smart_spaces_updated_at
before update on public.smart_spaces
for each row execute function private.set_updated_at();

drop trigger if exists set_workspace_invites_updated_at on public.workspace_invites;
create trigger set_workspace_invites_updated_at
before update on public.workspace_invites
for each row execute function private.set_updated_at();

alter table public.smart_spaces enable row level security;
alter table public.workspace_invites enable row level security;

drop policy if exists "Workspace members can read smart spaces" on public.smart_spaces;
create policy "Workspace members can read smart spaces"
on public.smart_spaces for select
to authenticated
using (private.is_workspace_member(workspace_id));

drop policy if exists "Workspace members can create smart spaces" on public.smart_spaces;
create policy "Workspace members can create smart spaces"
on public.smart_spaces for insert
to authenticated
with check (private.is_workspace_member(workspace_id) and (select auth.uid()) = created_by);

drop policy if exists "Workspace members can update own smart spaces" on public.smart_spaces;
create policy "Workspace members can update own smart spaces"
on public.smart_spaces for update
to authenticated
using (private.is_workspace_member(workspace_id) and ((select auth.uid()) = created_by or private.is_workspace_admin(workspace_id)))
with check (private.is_workspace_member(workspace_id));

drop policy if exists "Workspace members can delete own smart spaces" on public.smart_spaces;
create policy "Workspace members can delete own smart spaces"
on public.smart_spaces for delete
to authenticated
using (private.is_workspace_member(workspace_id) and ((select auth.uid()) = created_by or private.is_workspace_admin(workspace_id)));

drop policy if exists "Workspace admins can read invites" on public.workspace_invites;
create policy "Workspace admins can read invites"
on public.workspace_invites for select
to authenticated
using (private.is_workspace_admin(workspace_id));

drop policy if exists "Workspace admins can create invites" on public.workspace_invites;
create policy "Workspace admins can create invites"
on public.workspace_invites for insert
to authenticated
with check (private.is_workspace_admin(workspace_id) and (select auth.uid()) = created_by);

drop policy if exists "Workspace admins can update invites" on public.workspace_invites;
create policy "Workspace admins can update invites"
on public.workspace_invites for update
to authenticated
using (private.is_workspace_admin(workspace_id))
with check (private.is_workspace_admin(workspace_id));

drop policy if exists "Workspace admins can delete invites" on public.workspace_invites;
create policy "Workspace admins can delete invites"
on public.workspace_invites for delete
to authenticated
using (private.is_workspace_admin(workspace_id));
