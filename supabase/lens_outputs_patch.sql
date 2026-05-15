-- =============================================================================
-- node_lens_outputs — per-capture Insight Lens outputs (Feature 3.8)
-- =============================================================================
-- Cached LLM outputs from running an interpretive lens (Gist, ELI5, Contrarian
-- Take, Analogy, Hot Take, etc.) over a single capture. Re-running the same
-- lens hits the cache; explicit regenerate writes a new row and the UI can
-- show history per lens.
--
-- Apply in Supabase SQL editor.
-- =============================================================================

create table if not exists public.node_lens_outputs (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lens text not null check (char_length(trim(lens)) > 0),
  output text not null check (char_length(trim(output)) > 0),
  generated_by uuid references public.users(id) on delete set null,
  provider text,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists node_lens_outputs_node_lens_idx
  on public.node_lens_outputs(node_id, lens, created_at desc);

create index if not exists node_lens_outputs_workspace_idx
  on public.node_lens_outputs(workspace_id, created_at desc);

alter table public.node_lens_outputs enable row level security;

drop policy if exists "Workspace members can read lens outputs" on public.node_lens_outputs;
create policy "Workspace members can read lens outputs"
on public.node_lens_outputs for select
to authenticated
using (private.is_workspace_member(workspace_id));

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- drop table if exists public.node_lens_outputs;
