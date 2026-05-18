-- =============================================================================
-- insights provenance — where a saved insight came from
-- =============================================================================
-- Insights can now originate from a capture's lens output or a synthesis
-- essay (curated "Save to Insights"), not just hand-written. Track the
-- source so the UI can show "from <lens> on <capture>" and so we never
-- conflate machine-derived insights with the user's own writing.
--
-- Apply: psql ... -f supabase/insights_provenance_patch.sql
-- =============================================================================

alter table public.insights
  add column if not exists source_node_id uuid references public.nodes(id) on delete set null;

alter table public.insights
  add column if not exists source_kind text;

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- alter table public.insights drop column if exists source_kind;
-- alter table public.insights drop column if exists source_node_id;
