-- =============================================================================
-- node_workspaces — connect a capture to multiple Minds (Feature 1.5)
-- =============================================================================
-- Are.na-style: one capture (block) can live in many Minds (channels) without
-- duplication. The capture's HOME stays nodes.workspace_id; this junction
-- tracks ADDITIONAL Minds it's been connected to. Deleting the capture (home)
-- cascades; disconnecting from a non-home Mind just removes the junction row.
--
-- Apply in Supabase SQL editor.
-- =============================================================================

create table if not exists public.node_workspaces (
  node_id uuid not null references public.nodes(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  added_by uuid references public.users(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (node_id, workspace_id)
);

create index if not exists node_workspaces_workspace_idx
  on public.node_workspaces(workspace_id, added_at desc);

create index if not exists node_workspaces_node_idx
  on public.node_workspaces(node_id);

alter table public.node_workspaces enable row level security;

drop policy if exists "Members read node connections" on public.node_workspaces;
create policy "Members read node connections"
on public.node_workspaces for select
to authenticated
using (private.is_workspace_member(workspace_id));

-- Writes go through the server (service role) so connection changes are
-- validated against membership of BOTH the capture's home Mind and the target.

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- drop table if exists public.node_workspaces;
