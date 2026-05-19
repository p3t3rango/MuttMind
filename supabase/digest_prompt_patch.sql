-- =============================================================================
-- workspaces.digest_prompt — per-Mind prompt for the weekly Mind Digest
-- =============================================================================
-- A weekly Mind Digest is a synthesis run produced on a schedule with its
-- own steering prompt (distinct from ad-hoc Essay/Brief/Open-questions). When
-- set, the digest cron passes this as the synthesis prompt; otherwise the
-- default essay synthesis is used. Null = use the default.
--
-- Apply: psql ... -f supabase/digest_prompt_patch.sql
-- =============================================================================

alter table public.workspaces
  add column if not exists digest_prompt text;

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- alter table public.workspaces drop column if exists digest_prompt;
