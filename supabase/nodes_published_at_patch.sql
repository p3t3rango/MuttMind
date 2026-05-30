-- The original published/created date of the source (article publish time,
-- PDF document creation date, manual override). Distinct from `created_at`,
-- which is when the capture was *shared* into the Mind.
alter table public.nodes
  add column if not exists published_at timestamptz;
