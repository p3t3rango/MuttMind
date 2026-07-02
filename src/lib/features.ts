/**
 * UI feature switches. Unlike the env-driven LLM flags in env.ts, these are
 * plain constants: flip and redeploy.
 *
 * COLLECTIONS_ENABLED hides every Collections entry point (nav link,
 * add-to-collection actions) without removing the feature code or API routes.
 * /collections stays reachable by direct URL.
 */
export const COLLECTIONS_ENABLED = false;
