-- =============================================================================
-- moments — a Mind in "event mode" (shareable via QR/link)
-- =============================================================================
-- A Moment is a workspace with event_mode on: it has an optional event date,
-- a short public share_code (the /m/<code> landing), and a per-Moment toggle
-- for anonymous contributions. Public/anon reads & writes go through server
-- routes using the service role, so no RLS change is needed here.
--
-- Apply: psql ... -f supabase/moments_patch.sql
-- =============================================================================

alter table public.workspaces
  add column if not exists event_mode boolean not null default false;

alter table public.workspaces
  add column if not exists event_at timestamptz;

alter table public.workspaces
  add column if not exists share_code text;

alter table public.workspaces
  add column if not exists allow_anonymous_contributions boolean not null default false;

create unique index if not exists workspaces_share_code_key
  on public.workspaces(share_code)
  where share_code is not null;

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- drop index if exists workspaces_share_code_key;
-- alter table public.workspaces drop column if exists allow_anonymous_contributions;
-- alter table public.workspaces drop column if exists share_code;
-- alter table public.workspaces drop column if exists event_at;
-- alter table public.workspaces drop column if exists event_mode;
