-- Idempotency for the Telegram webhook. Telegram re-delivers an update if it
-- doesn't receive a fast 200; the webhook ran the (slow) capture synchronously
-- with no dedup, so one link saved 5+ times. Record each processed update_id;
-- a repeat delivery hits the primary-key conflict and is acked + skipped.
create table if not exists public.telegram_updates (
  update_id bigint primary key,
  created_at timestamptz not null default now()
);
