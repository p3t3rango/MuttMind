'use client';
import { createClient } from '@supabase/supabase-js';
export const supabaseBrowser = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '');
export async function getAccessToken(): Promise<string> { const { data } = await supabaseBrowser.auth.getSession(); return data.session?.access_token ?? ''; }
