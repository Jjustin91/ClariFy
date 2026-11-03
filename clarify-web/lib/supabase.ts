import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    !supabaseUrl.includes('placeholder.supabase.co')
);

/**
 * Singleton Supabase client initialized with NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.
 * Safe fallback placeholders prevent runtime initialization errors when env vars are omitted in local preview.
 */
export const supabase: SupabaseClient = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'public-anon-key-placeholder',
  {
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  }
);
