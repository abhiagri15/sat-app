'use server';

// Server-action wrappers around config.ts reads so 'use client' modules
// (e.g. app/hooks/useTestSession.ts) can invoke them without importing
// the server-only supabase client transitively. Keep this file as a
// thin re-export — all the read logic stays in app/lib/config.ts.

import { getModule2ThresholdPct as _getModule2ThresholdPct } from '@/app/lib/config';

export async function getModule2ThresholdPct(): Promise<number> {
  return _getModule2ThresholdPct();
}
