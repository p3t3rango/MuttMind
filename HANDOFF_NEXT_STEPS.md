# MuttMind Runbook (Post-Clone)
1. Add env vars in `.env.local`.
2. In Supabase, enable email/password auth.
3. Run SQL in `supabase/schema.sql`.
4. Use `/login` to sign up or sign in.
5. Use `/dashboard` to create the first workspace. The API creates the owner membership automatically.
6. Optional: set `public.users.telegram_user_id` for your user, then configure Telegram to call `/api/telegram-webhook`.
7. Use `/dashboard` to capture links/text, then `/vault` to browse saved nodes.
