# MuttMind Status

## Current State
- Working directory: `/Users/peterarango/cursor experiments/MuttMind`
- Branch: `main`
- Latest pushed app commit: `2fbfca9 Add capture notes and summary improvement`
- Supabase notes migration: applied successfully by user in Supabase SQL editor.

## Recently Completed
- Capture detail drawer now supports a persistent note log.
- Notes are additive and do not change summaries automatically.
- `Improve Summary` is a separate action that uses saved notes as context.
- `X_BEARER_TOKEN` is documented in `.env.example` and configured by user locally/Vercel.

## In Progress
- Fix capture detail drawer layout so it does not horizontally overflow smaller browser windows.
- Fix settings page visual consistency and layout density.

## Known Issues / Next
- Implement X/Twitter enrichment queue using the configured bearer token.
- Add Vercel Cron for rate-limited tweet hydration.
- Improve source extraction order: `llms.txt`, page text, OG metadata, X API, then optional screenshot/visual analysis.
- Continue mobile polish for capture, settings, and detail drawer flows.
