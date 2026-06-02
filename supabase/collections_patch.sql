-- Collections — archive as creative form (plan #2 of 4)

-- Workspaces gain a cross-publish opt-in (used at add-time and on render in plan #4)
alter table public.workspaces
  add column if not exists allow_member_cross_publish boolean not null default false;

-- Collections themselves
create table if not exists public.collections (
  id              uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null references public.users(id) on delete cascade,
  title           text not null default 'Untitled Collection',
  description     text,
  cover_path      text,
  default_view    text not null default 'editorial',
  enabled_views   text[] not null default array['editorial']::text[],
  show_summary    boolean not null default false,
  show_tags       boolean not null default false,
  show_notes      boolean not null default false,
  status          text not null default 'draft',
  share_code      text unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists collections_owner_idx on public.collections(owner_user_id);

-- Items within a collection (capture references or curator text blocks)
create table if not exists public.collection_items (
  id            uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  position      integer not null,
  kind          text not null,
  node_id       uuid references public.nodes(id) on delete set null,
  caption       text,
  text_body     text,
  created_at    timestamptz not null default now(),
  constraint collection_items_kind_chk
    check (kind in ('capture','text')),
  constraint collection_items_capture_has_node_chk
    check (kind <> 'capture' or node_id is not null),
  constraint collection_items_text_has_body_chk
    check (kind <> 'text' or text_body is not null)
);

create index if not exists collection_items_collection_idx
  on public.collection_items(collection_id, position);

-- Editor invites (owner is implicit; not duplicated here)
create table if not exists public.collection_members (
  collection_id uuid not null references public.collections(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  role          text not null default 'editor',
  invited_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (collection_id, user_id),
  constraint collection_members_role_chk check (role in ('editor'))
);
