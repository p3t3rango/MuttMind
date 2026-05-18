-- =============================================================================
-- nodes.scrape_kind — persist the extractor's detected content kind
-- =============================================================================
-- scrape.ts already classifies every captured URL as one of
-- article | pdf | youtube | tweet | image | file, but the value was discarded
-- after extraction. Persisting it lets the UI render type-aware cards and the
-- composer confirm what was detected, without re-deriving from URL regex.
--
-- Apply: supabase db query --linked --file supabase/nodes_kind_patch.sql
-- =============================================================================

alter table public.nodes
  add column if not exists scrape_kind text;

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- alter table public.nodes drop column if exists scrape_kind;
