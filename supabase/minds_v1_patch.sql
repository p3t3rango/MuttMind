-- =============================================================================
-- Minds v1 — collapse Spaces into Minds (Are.na-aligned)
-- =============================================================================
-- The Mind (workspace) is now the unit. There is no separate "Space" concept.
-- A Mind has its own system prompt, voice configuration, provider, and model.
-- A Shared Mind is just a Mind with multiple members.
--
-- This migration:
--   1. Promotes the per-Space configuration fields onto the workspaces table.
--   2. Drops the redundant default_* columns (added during the brief Spaces era).
--   3. Drops smart_spaces and its indexes / policies / triggers entirely.
--
-- Apply in Supabase SQL editor. ROLLBACK at the bottom.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Promote configuration fields onto workspaces
-- -----------------------------------------------------------------------------
alter table public.workspaces
  add column if not exists system_prompt text,
  add column if not exists voice_source text not null default 'system_prompt'
    check (voice_source in ('system_prompt', 'user_notes', 'mind_notes')),
  add column if not exists voice_user_ids uuid[] not null default '{}',
  add column if not exists provider text not null default 'gemini',
  add column if not exists model text;

-- Drop the brief-lived default_* columns (they were defaults for Spaces, which
-- no longer exist as a separate concept).
alter table public.workspaces
  drop column if exists default_system_prompt,
  drop column if exists default_provider,
  drop column if exists default_model;

-- -----------------------------------------------------------------------------
-- Drop smart_spaces entirely
-- -----------------------------------------------------------------------------
drop trigger if exists set_smart_spaces_updated_at on public.smart_spaces;
drop table if exists public.smart_spaces cascade;

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- Run only to undo. Restores the smart_spaces table shape (without the v2 fields)
-- and the workspaces.default_* columns. Captures stay where they are.
-- =============================================================================
--
-- alter table public.workspaces
--   drop column if exists system_prompt,
--   drop column if exists voice_source,
--   drop column if exists voice_user_ids,
--   drop column if exists provider,
--   drop column if exists model;
--
-- alter table public.workspaces
--   add column if not exists default_system_prompt text,
--   add column if not exists default_provider text not null default 'gemini',
--   add column if not exists default_model text;
--
-- create table if not exists public.smart_spaces (
--   id uuid primary key default gen_random_uuid(),
--   workspace_id uuid not null references public.workspaces(id) on delete cascade,
--   created_by uuid not null references public.users(id) on delete restrict,
--   name text not null check (char_length(trim(name)) > 0),
--   query text not null default '',
--   color text not null default '#7c3aed',
--   created_at timestamptz not null default now(),
--   updated_at timestamptz not null default now()
-- );
