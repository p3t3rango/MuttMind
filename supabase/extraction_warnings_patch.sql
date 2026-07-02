-- Persist scraper extraction warnings on nodes so the UI can surface capture
-- health (e.g. "site blocked automated access") instead of failing silently.
-- Apply in the Supabase SQL editor, like the other *_patch.sql files.
alter table public.nodes
  add column if not exists extraction_warnings jsonb;
