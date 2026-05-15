-- =============================================================================
-- Spaces v2: make query (filter) optional
-- =============================================================================
-- The original smart_spaces.query was required + non-empty. In the new model,
-- a Space's identity is its system prompt + voice + purpose; the filter is
-- only meaningful if the user wants the Space to also act as a saved search.
-- This patch drops the non-empty check so empty filter is allowed.
-- The NOT NULL stays — empty string is still NOT NULL.
--
-- Apply in Supabase SQL editor.
-- =============================================================================

alter table public.smart_spaces drop constraint if exists smart_spaces_query_check;

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- alter table public.smart_spaces
--   add constraint smart_spaces_query_check check (char_length(trim(query)) > 0);
