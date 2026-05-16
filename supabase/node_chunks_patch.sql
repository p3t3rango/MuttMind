-- =============================================================================
-- node_chunks — passage-level embeddings for retrieval-driven synthesis (Stage 2)
-- =============================================================================
-- A node's raw_text is split into overlapping ~1k-token passages, each embedded
-- on its own. Synthesis retrieves the most relevant passages across a selected
-- node set instead of feeding whole documents or thin summaries. The node-level
-- nodes.embedding stays as the coarse selector / fallback.
--
-- Apply: supabase db query --linked --file supabase/node_chunks_patch.sql
-- =============================================================================

create table if not exists public.node_chunks (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  chunk_index int not null,
  content text not null check (char_length(trim(content)) > 0),
  token_estimate int,
  embedding extensions.vector(768),
  created_at timestamptz not null default now(),
  unique (node_id, chunk_index)
);

create index if not exists node_chunks_node_idx on public.node_chunks(node_id);
create index if not exists node_chunks_workspace_idx on public.node_chunks(workspace_id);
-- pgvector (HNSW) index deferred to Stage 3 — JS cosine over a selected node
-- set is fine at current scale.

alter table public.node_chunks enable row level security;

drop policy if exists "Workspace members can read node chunks" on public.node_chunks;
create policy "Workspace members can read node chunks"
on public.node_chunks for select
to authenticated
using (private.is_workspace_member(workspace_id));

-- Writes from the server only (service role).

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- drop table if exists public.node_chunks;
