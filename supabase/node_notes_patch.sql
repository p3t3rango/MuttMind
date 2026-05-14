alter table public.nodes
add column if not exists user_notes text;

create table if not exists public.node_notes (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes(id) on delete cascade,
  created_by uuid not null references public.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists node_notes_node_created_at_idx on public.node_notes(node_id, created_at desc);

alter table public.node_notes enable row level security;

drop policy if exists "Workspace members can read node notes" on public.node_notes;
create policy "Workspace members can read node notes"
on public.node_notes for select
to authenticated
using (
  exists (
    select 1
    from public.nodes n
    where n.id = node_notes.node_id
      and private.is_workspace_member(n.workspace_id)
  )
);

drop policy if exists "Workspace members can create node notes" on public.node_notes;
create policy "Workspace members can create node notes"
on public.node_notes for insert
to authenticated
with check (
  (select auth.uid()) = created_by
  and exists (
    select 1
    from public.nodes n
    where n.id = node_notes.node_id
      and private.is_workspace_member(n.workspace_id)
  )
);

drop policy if exists "Note authors can delete node notes" on public.node_notes;
create policy "Note authors can delete node notes"
on public.node_notes for delete
to authenticated
using (
  (select auth.uid()) = created_by
  or exists (
    select 1
    from public.nodes n
    where n.id = node_notes.node_id
      and private.is_workspace_admin(n.workspace_id)
  )
);
