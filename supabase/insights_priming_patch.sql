-- Per-item priming control + multi-citation provenance for insights.
-- feeds_priming: whether this insight primes future synthesis/chat.
--   Existing rows default true (they were already feeding — don't silently
--   change live Minds). New AI-authored saves are inserted with false by the
--   app layer (see createInsight).
-- source_node_ids: the full citation set for a saved chat answer (the singular
--   source_node_id stays for lens-saves).
alter table public.insights
  add column if not exists feeds_priming boolean not null default true;

alter table public.insights
  add column if not exists source_node_ids uuid[] not null default '{}';
