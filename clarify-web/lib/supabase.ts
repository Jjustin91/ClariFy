import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Normalizes and validates NEXT_PUBLIC_SUPABASE_URL so that missing, quoted,
 * bare-domain, project-ref, or accidental postgresql:// connection strings
 * never cause @supabase/supabase-js to throw:
 * "Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL."
 */
export function resolveValidSupabaseUrl(raw?: string): string | null {
  if (!raw) return null;

  let val = raw.trim().replace(/^['"]+|['"]+$/g, '').trim();
  if (
    !val ||
    val === 'undefined' ||
    val === 'null' ||
    val.includes('placeholder.supabase.co') ||
    val.includes('your-project-ref')
  ) {
    return null;
  }

  // Handle accidental postgresql:// or postgres:// connection URI by extracting the project ref
  if (/^postgres(?:ql)?:\/\//i.test(val)) {
    const poolerMatch = val.match(/postgres\.([a-z0-9]{10,30})[:@]/i);
    const directHostMatch = val.match(/db\.([a-z0-9]{10,30})\.supabase\.co/i);
    const projectRef = poolerMatch?.[1] || directHostMatch?.[1];
    if (projectRef) {
      val = `https://${projectRef}.supabase.co`;
    } else {
      return null;
    }
  } else if (!/^https?:\/\//i.test(val)) {
    // Handle bare domain (e.g. "xyz.supabase.co") or bare project reference ID
    if (val.includes('.supabase.co') || val.includes('.supabase.in')) {
      val = `https://${val.replace(/^\/+/, '')}`;
    } else if (/^[a-z0-9]{15,25}$/i.test(val)) {
      val = `https://${val}.supabase.co`;
    } else {
      return null;
    }
  }

  try {
    const parsed = new URL(val);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function resolveValidSupabaseAnonKey(raw?: string): string | null {
  if (!raw) return null;
  const val = raw.trim().replace(/^['"]+|['"]+$/g, '').trim();
  if (
    !val ||
    val === 'undefined' ||
    val === 'null' ||
    val === 'your-supabase-anon-key' ||
    val === 'public-anon-key-placeholder'
  ) {
    return null;
  }
  return val;
}

const validatedSupabaseUrl = resolveValidSupabaseUrl(
  process.env.NEXT_PUBLIC_SUPABASE_URL
);
const validatedSupabaseAnonKey = resolveValidSupabaseAnonKey(
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export const isSupabaseConfigured = Boolean(
  validatedSupabaseUrl && validatedSupabaseAnonKey
);

let cachedClient: SupabaseClient | null = null;

/**
 * Lazily returns a validated SupabaseClient instance, or null if env vars
 * are absent or invalid. Guaranteed never to throw at import or runtime.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (!validatedSupabaseUrl || !validatedSupabaseAnonKey) {
    return null;
  }
  if (cachedClient) {
    return cachedClient;
  }
  try {
    cachedClient = createClient(validatedSupabaseUrl, validatedSupabaseAnonKey, {
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    });
    return cachedClient;
  } catch {
    return null;
  }
}

/**
 * Safe Supabase client export using the validated HTTP/HTTPS URL (or safe fallback).
 */
export const supabase: SupabaseClient =
  getSupabaseClient() ??
  createClient(
    validatedSupabaseUrl || 'https://placeholder.supabase.co',
    validatedSupabaseAnonKey || 'public-anon-key-placeholder',
    {
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    }
  );

