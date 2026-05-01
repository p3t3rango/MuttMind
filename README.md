# MuttMind MVP Scaffold

## Quick start
1. Copy `.env.example` to `.env.local` and fill values.
2. Run `npm install`.
3. Run SQL from `supabase/schema.sql` in Supabase.
4. Run `npm run dev`.

## Included end-to-end MVP (outside keys + DB provisioning)
- Supabase email/password auth UI (`/login`).
- Team workspace creation + membership bootstrap (`/dashboard`).
- Capture flow (`/api/capture`) with dynamic framework tags.
- Telegram webhook ingestion (`/api/telegram-webhook`) with secret validation and user mapping.
- Workspace-scoped vault fetch (`/api/nodes` + `/vault`).
- Workspace tag CRUD API + dashboard controls.
- LLM provider adapter pattern in `src/lib/llm.ts`.
