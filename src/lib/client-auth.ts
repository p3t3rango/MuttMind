'use client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowser() {
  if (!browserClient) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Missing Supabase browser configuration.');
    }

    browserClient = createClient(
      supabaseUrl,
      supabaseAnonKey,
    );
  }

  return browserClient;
}

export async function getAccessToken(): Promise<string> {
  const { data } = await getSupabaseBrowser().auth.getSession();
  return data.session?.access_token ?? '';
}

export async function authedFetch(url: string, init?: RequestInit) {
  const token = await getAccessToken();

  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
}
