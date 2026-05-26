// app/lib/marketing/queries.ts
//
// Public-page data fetchers. Uses a plain anon-key Supabase client — NO
// cookie binding — so the marketing page stays compatible with Next.js ISR.
// The existing app/lib/supabase/server.ts is cookie-bound for SSR auth flows;
// binding cookies on a public page would force Next into dynamic rendering
// and defeat revalidate=3600.

import { createClient } from '@supabase/supabase-js';

export interface PublicPoolStatsCell {
  section: 'rw' | 'math';
  difficulty: 'easy' | 'medium' | 'hard';
  count: number;
}

export interface PublicPoolStats {
  totalEnabled: number;
  rwCount: number;
  mathCount: number;
  easyCount: number;
  mediumCount: number;
  hardCount: number;
  skillCount: number;
  // 2x3 cross-tab. May omit cells with count 0; consumer should default
  // missing (section, difficulty) keys to 0.
  cells: PublicPoolStatsCell[];
  lastRefreshed: string | null; // ISO timestamp or null if no AI questions yet
  asOf: string; // ISO timestamp of when the RPC ran
}

// Returns null on any error so the calling page can render a graceful
// fallback. We never throw across this boundary.
export async function getPublicPoolStats(): Promise<PublicPoolStats | null> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data, error } = await supabase.schema('sat').rpc('public_pool_stats');
    if (error || !data) {
      console.error('[getPublicPoolStats] RPC error:', error);
      return null;
    }
    return data as unknown as PublicPoolStats;
  } catch (e) {
    console.error('[getPublicPoolStats] unexpected error:', e);
    return null;
  }
}
