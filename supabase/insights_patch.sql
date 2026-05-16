-- =============================================================================
-- insights — user-authored journal entries per Mind (Feature: Insights)
-- =============================================================================
-- Distinct from `essays` (AI synthesis output) and `mind_memory` (system
-- substrate). These are the human's own written reflections on a Mind. The AI
-- assistant reads recent insights as high-priority priming for synthesis/ask.
-- Editable and deletable by the author (or a Mind owner/admin).
--
-- Apply: supabase db query --linked --file supabase/insights_patch.sql
-- =============================================================================

create table if not exists public.insights (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid references public.users(id) on delete set null,
  title text,
  body text not null check (char_length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists insights_workspace_created_at_idx
  on public.insights(workspace_id, created_at desc);

drop trigger if exists set_insights_updated_at on public.insights;
create trigger set_insights_updated_at
before update on public.insights
for each row execute function private.set_updated_at();

alter table public.insights enable row level security;

drop policy if exists "Workspace members can read insights" on public.insights;
create policy "Workspace members can read insights"
on public.insights for select
to authenticated
using (private.is_workspace_member(workspace_id));

-- Writes/edits/deletes go through the server (service role); the API enforces
-- author-or-admin rules.

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- drop table if exists public.insights;
