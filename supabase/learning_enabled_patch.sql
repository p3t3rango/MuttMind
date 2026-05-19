-- =============================================================================
-- workspaces.learning_enabled — per-Mind opt-in for the learning loop
-- =============================================================================
-- Gates the Hermes-pattern learning loop: when true, synthesis distills one
-- durable "learning" (insights row, source_kind='learned') and the weekly
-- digest cron runs the consolidation pass for this Mind. Default false —
-- nothing distills or consolidates until the owner opts in (cost control).
--
-- Apply: psql ... -f supabase/learning_enabled_patch.sql
-- =============================================================================

alter table public.workspaces
  add column if not exists learning_enabled boolean not null default false;

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- alter table public.workspaces drop column if exists learning_enabled;
