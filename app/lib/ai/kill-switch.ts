// SERVER ONLY. The global AI kill switch (audit C4).
//
// This tiny module exists to break an import cycle: both app/lib/ai/generate.ts
// and app/lib/practice/generation.ts need the ai_enabled check, but
// generation.ts already imports generate.ts (for generateBatchForSkill), so
// putting the helper in either of them would create a cycle. It lives here
// instead, imported by both.
//
// It does NOT import the service-role client factory — the caller passes its
// already-constructed service-role client in as an argument, typed structurally
// as a SupabaseClient. That keeps the 8-file service-role invariant intact (see
// the AI sub-project gotchas in CLAUDE.md): this file is NOT a new
// createAdminClient import site, and the secret-leak scan must not list it.

import type { SupabaseClient } from '@supabase/supabase-js';

// Is AI generation enabled app-wide? Reads sat.app_config.ai_enabled (single
// row, id = 1). FAIL-OPEN: a null row, a missing column, or a read error all
// return true — an observability read must never brick generation. Only an
// explicit `false` disables AI.
//
// The `admin` argument is the caller's service-role client (SupabaseClient).
// It is typed structurally so this module does not import the admin factory.
export async function aiIsEnabled(admin: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await admin
      .schema('sat')
      .from('app_config')
      .select('ai_enabled')
      .eq('id', 1)
      .maybeSingle();
    if (error || !data) {
      console.error('[kill-switch] aiIsEnabled read failed (fail-open):', error);
      return true;
    }
    const value = (data as { ai_enabled: boolean | null }).ai_enabled;
    // Only an explicit false disables AI; null/undefined fail open.
    return value !== false;
  } catch (e) {
    console.error('[kill-switch] aiIsEnabled unexpected error (fail-open):', e);
    return true;
  }
}
