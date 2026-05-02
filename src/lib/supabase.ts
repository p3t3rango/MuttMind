import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

let adminClient: SupabaseClient<any> | null = null;

export function getSupabaseAdmin() {
  if (!adminClient) {
    if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
      throw new Error('Missing Supabase server configuration.');
    }

    adminClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });
  }

  return adminClient;
}
