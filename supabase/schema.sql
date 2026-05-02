-- MuttMind Supabase schema
-- Run this in the Supabase SQL editor after creating the project.

create extension if not exists pgcrypto;

create schema if not exists private;
create schema if not exists extensions;

create extension if not exists vector with schema extensions;
alter extension vector set schema extensions;

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  telegram_user_id bigint unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) > 0),
  markdown_content text,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.workspaces
add column if not exists markdown_content text;

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.nodes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references public.users(id) on delete restrict,
  content_type text not null check (content_type in ('link', 'text')),
  original_url text,
  raw_text text,
  title text,
  og_image_url text,
  source_description text,
  source_author text,
  ai_summary text,
  embedding vector(768),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (original_url is not null or raw_text is not null)
);

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  shift_name text not null check (char_length(trim(shift_name)) > 0),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, shift_name)
);

create table if not exists public.node_tags (
  node_id uuid not null references public.nodes(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (node_id, tag_id)
);

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

create table if not exists public.telegram_sessions (
  telegram_user_id bigint primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  active_workspace_id uuid references public.workspaces(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_members_user_id_idx on public.workspace_members(user_id);
create index if not exists nodes_workspace_created_at_idx on public.nodes(workspace_id, created_at desc);
create index if not exists tags_workspace_shift_name_idx on public.tags(workspace_id, shift_name);
create index if not exists node_tags_tag_id_idx on public.node_tags(tag_id);
create index if not exists smart_spaces_workspace_created_at_idx on public.smart_spaces(workspace_id, created_at desc);
create index if not exists workspace_invites_workspace_created_at_idx on public.workspace_invites(workspace_id, created_at desc);
create index if not exists workspace_invites_email_idx on public.workspace_invites(lower(email));
create index if not exists workspace_invites_token_idx on public.workspace_invites(token);
create index if not exists users_telegram_user_id_idx on public.users(telegram_user_id);
create index if not exists telegram_sessions_user_id_idx on public.telegram_sessions(user_id);
create index if not exists telegram_sessions_active_workspace_id_idx on public.telegram_sessions(active_workspace_id);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_users_updated_at on public.users;
create trigger set_users_updated_at
before update on public.users
for each row execute function private.set_updated_at();

drop trigger if exists set_workspaces_updated_at on public.workspaces;
create trigger set_workspaces_updated_at
before update on public.workspaces
for each row execute function private.set_updated_at();

drop trigger if exists set_nodes_updated_at on public.nodes;
create trigger set_nodes_updated_at
before update on public.nodes
for each row execute function private.set_updated_at();

drop trigger if exists set_tags_updated_at on public.tags;
create trigger set_tags_updated_at
before update on public.tags
for each row execute function private.set_updated_at();

drop trigger if exists set_smart_spaces_updated_at on public.smart_spaces;
create trigger set_smart_spaces_updated_at
before update on public.smart_spaces
for each row execute function private.set_updated_at();

drop trigger if exists set_workspace_invites_updated_at on public.workspace_invites;
create trigger set_workspace_invites_updated_at
before update on public.workspace_invites
for each row execute function private.set_updated_at();

drop trigger if exists set_telegram_sessions_updated_at on public.telegram_sessions;
create trigger set_telegram_sessions_updated_at
before update on public.telegram_sessions
for each row execute function private.set_updated_at();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do update
  set email = excluded.email,
      display_name = coalesce(public.users.display_name, excluded.display_name);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

create or replace function private.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
  );
$$;

create or replace function private.is_workspace_admin(target_workspace_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.role in ('owner', 'admin')
  );
$$;

grant usage on schema private to authenticated;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.is_workspace_admin(uuid) to authenticated;

alter table public.users enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.nodes enable row level security;
alter table public.tags enable row level security;
alter table public.node_tags enable row level security;
alter table public.smart_spaces enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.telegram_sessions enable row level security;

drop policy if exists "Users can read own profile" on public.users;
create policy "Users can read own profile"
on public.users for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "Users can update own profile" on public.users;
create policy "Users can update own profile"
on public.users for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "Workspace members can read workspaces" on public.workspaces;
create policy "Workspace members can read workspaces"
on public.workspaces for select
to authenticated
using (private.is_workspace_member(id));

drop policy if exists "Authenticated users can create workspaces" on public.workspaces;
create policy "Authenticated users can create workspaces"
on public.workspaces for insert
to authenticated
with check ((select auth.uid()) = created_by);

drop policy if exists "Workspace admins can update workspaces" on public.workspaces;
create policy "Workspace admins can update workspaces"
on public.workspaces for update
to authenticated
using (private.is_workspace_admin(id))
with check (private.is_workspace_admin(id));

drop policy if exists "Members can read workspace memberships" on public.workspace_members;
create policy "Members can read workspace memberships"
on public.workspace_members for select
to authenticated
using (private.is_workspace_member(workspace_id));

drop policy if exists "Workspace owners and admins can add members" on public.workspace_members;
create policy "Workspace owners and admins can add members"
on public.workspace_members for insert
to authenticated
with check (private.is_workspace_admin(workspace_id));

drop policy if exists "Workspace owners and admins can update members" on public.workspace_members;
create policy "Workspace owners and admins can update members"
on public.workspace_members for update
to authenticated
using (private.is_workspace_admin(workspace_id))
with check (private.is_workspace_admin(workspace_id));

drop policy if exists "Workspace owners and admins can remove members" on public.workspace_members;
create policy "Workspace owners and admins can remove members"
on public.workspace_members for delete
to authenticated
using (private.is_workspace_admin(workspace_id));

drop policy if exists "Workspace members can read nodes" on public.nodes;
create policy "Workspace members can read nodes"
on public.nodes for select
to authenticated
using (private.is_workspace_member(workspace_id));

drop policy if exists "Workspace members can create nodes" on public.nodes;
create policy "Workspace members can create nodes"
on public.nodes for insert
to authenticated
with check (private.is_workspace_member(workspace_id) and (select auth.uid()) = created_by);

drop policy if exists "Workspace members can update nodes" on public.nodes;
create policy "Workspace members can update nodes"
on public.nodes for update
to authenticated
using (private.is_workspace_member(workspace_id))
with check (private.is_workspace_member(workspace_id));

drop policy if exists "Workspace members can delete nodes" on public.nodes;
create policy "Workspace members can delete nodes"
on public.nodes for delete
to authenticated
using (private.is_workspace_member(workspace_id));

drop policy if exists "Workspace members can read tags" on public.tags;
create policy "Workspace members can read tags"
on public.tags for select
to authenticated
using (private.is_workspace_member(workspace_id));

drop policy if exists "Workspace members can create tags" on public.tags;
create policy "Workspace members can create tags"
on public.tags for insert
to authenticated
with check (private.is_workspace_member(workspace_id));

drop policy if exists "Workspace members can update tags" on public.tags;
create policy "Workspace members can update tags"
on public.tags for update
to authenticated
using (private.is_workspace_member(workspace_id))
with check (private.is_workspace_member(workspace_id));

drop policy if exists "Workspace members can delete tags" on public.tags;
create policy "Workspace members can delete tags"
on public.tags for delete
to authenticated
using (private.is_workspace_member(workspace_id));

drop policy if exists "Workspace members can read node tags" on public.node_tags;
create policy "Workspace members can read node tags"
on public.node_tags for select
to authenticated
using (
  exists (
    select 1
    from public.nodes n
    where n.id = node_tags.node_id
      and private.is_workspace_member(n.workspace_id)
  )
);

drop policy if exists "Workspace members can create node tags" on public.node_tags;
create policy "Workspace members can create node tags"
on public.node_tags for insert
to authenticated
with check (
  exists (
    select 1
    from public.nodes n
    join public.tags t on t.workspace_id = n.workspace_id
    where n.id = node_tags.node_id
      and t.id = node_tags.tag_id
      and private.is_workspace_member(n.workspace_id)
  )
);

drop policy if exists "Workspace members can delete node tags" on public.node_tags;
create policy "Workspace members can delete node tags"
on public.node_tags for delete
to authenticated
using (
  exists (
    select 1
    from public.nodes n
    where n.id = node_tags.node_id
      and private.is_workspace_member(n.workspace_id)
  )
);

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

drop policy if exists "Users can read own telegram sessions" on public.telegram_sessions;
create policy "Users can read own telegram sessions"
on public.telegram_sessions for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create own telegram sessions" on public.telegram_sessions;
create policy "Users can create own telegram sessions"
on public.telegram_sessions for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and (active_workspace_id is null or private.is_workspace_member(active_workspace_id))
);

drop policy if exists "Users can update own telegram sessions" on public.telegram_sessions;
create policy "Users can update own telegram sessions"
on public.telegram_sessions for update
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and (active_workspace_id is null or private.is_workspace_member(active_workspace_id))
);

create or replace function private.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name = 'public' then
      execute format('alter table if exists %s enable row level security', cmd.object_identity);
    end if;
  end loop;
end;
$$;

drop event trigger if exists ensure_public_rls;
drop event trigger if exists ensure_rls;
create event trigger ensure_public_rls
on ddl_command_end
when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
execute function private.rls_auto_enable();

drop function if exists public.rls_auto_enable();
