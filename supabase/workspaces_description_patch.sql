-- =============================================================================
-- workspaces.description — short one-liner shown in the new-Mind modal and on
-- Mind cards in the /minds index.
-- =============================================================================

alter table public.workspaces
  add column if not exists description text;

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- alter table public.workspaces drop column if exists description;
