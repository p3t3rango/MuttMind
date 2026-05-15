-- =============================================================================
-- essays — synthesis output artifacts (Feature 3)
-- =============================================================================
-- Each essay is a synthesis run over a Mind's corpus. Stored with full
-- provenance (source_node_ids), the trail of what was considered/picked/
-- dropped, and the model used.
--
-- Apply in Supabase SQL editor.
-- =============================================================================

create table if not exists public.essays (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text,
  body_md text not null check (char_length(trim(body_md)) > 0),
  source_node_ids uuid[] not null default '{}',
  generated_by uuid references public.users(id) on delete set null,
  provider text,
  model text,
  trail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists essays_workspace_created_at_idx
  on public.essays(workspace_id, created_at desc);

alter table public.essays enable row level security;

drop policy if exists "Workspace members can read essays" on public.essays;
create policy "Workspace members can read essays"
on public.essays for select
to authenticated
using (private.is_workspace_member(workspace_id));

-- Writes from the server only (service role).

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- drop table if exists public.essays;
