import { createClient } from '@supabase/supabase-js';

// Service-role Supabase client — SERVER ONLY. Bypasses RLS.
// NEVER import this into a 'use client' module.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
