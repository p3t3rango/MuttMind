-- =============================================================================
-- workspace_digest_prefs — per-member weekly digest opt-in (Feature 4)
-- =============================================================================
-- Default opt-OUT. Nobody receives a Telegram digest unless they explicitly
-- turn it on for a given Mind. last_sent_at gates the weekly cadence so the
-- cron never double-sends.
--
-- Apply in Supabase SQL editor.
-- =============================================================================

create table if not exists public.workspace_digest_prefs (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  opt_in boolean not null default false,
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_digest_prefs_optin_idx
  on public.workspace_digest_prefs(workspace_id) where opt_in = true;

drop trigger if exists set_workspace_digest_prefs_updated_at on public.workspace_digest_prefs;
create trigger set_workspace_digest_prefs_updated_at
before update on public.workspace_digest_prefs
for each row execute function private.set_updated_at();

alter table public.workspace_digest_prefs enable row level security;

drop policy if exists "Members read own digest prefs" on public.workspace_digest_prefs;
create policy "Members read own digest prefs"
on public.workspace_digest_prefs for select
to authenticated
using (private.is_workspace_member(workspace_id));

-- Writes go through the server (service role) so opt-in state stays auditable.

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- drop table if exists public.workspace_digest_prefs;
