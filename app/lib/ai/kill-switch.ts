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
// row, id = 1). FAIL-CLOSED: a read error, a thrown exception, or a missing
// row all return false — this is a SPEND/emergency stop, and an emergency
// stop that silently reverts to "on" when its own config read breaks is not a
// stop at all (the read is most likely to fail exactly when things are
// broken). A successful read enables unless the value is an explicit `false`
// (the column is `not null default true`, so null only appears pre-migration
// — treat it as enabled).
//
// The cost of failing closed is bounded and graceful: every caller already
// has a no-AI degraded path (static lesson, cooled_down, healthy-skip,
// `failed`, or an aiEnabled:false run summary), and if app_config is
// unreadable the subsequent service-role INSERTs would likely fail anyway —
// the Ollama spend would buy nothing. (This flips the original audit-C4
// fail-open decision, which optimized for generation availability over stop
// reliability.)
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
      console.error('[kill-switch] aiIsEnabled read failed (FAIL-CLOSED — AI disabled this call):', error);
      return false;
    }
    const value = (data as { ai_enabled: boolean | null }).ai_enabled;
    // Explicit false disables; true (or a pre-migration null) enables.
    return value !== false;
  } catch (e) {
    console.error('[kill-switch] aiIsEnabled unexpected error (FAIL-CLOSED — AI disabled this call):', e);
    return false;
  }
}
