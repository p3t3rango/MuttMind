-- Event/Moment end time. event_at is the start; event_end_at is the optional
-- end, so a Moment can span a range (e.g. a multi-day conference) rather than a
-- single instant. Nullable — events without an end keep working unchanged.
alter table public.workspaces
  add column if not exists event_end_at timestamptz;
