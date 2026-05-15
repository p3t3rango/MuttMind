-- =============================================================================
-- workspaces.privacy — Are.na-style three-tier privacy
--   open    — anyone can view AND add (public)
--   closed  — anyone can view; only collaborators can add
--   private — only collaborators can view AND add (default)
-- =============================================================================
-- For now, ONLY 'private' has its runtime behavior wired (the current default
-- members-only RLS). 'open' and 'closed' store user intent; their public
-- viewer / open-write routes will be wired in a follow-on chunk that adds
-- the necessary RLS policies and unauth'd routes.
-- =============================================================================

alter table public.workspaces
  add column if not exists privacy text not null default 'private'
    check (privacy in ('open', 'closed', 'private'));

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- alter table public.workspaces drop column if exists privacy;
