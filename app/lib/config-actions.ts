'use server';

// Server-action wrappers around config.ts reads so 'use client' modules
// (e.g. app/hooks/useTestSession.ts) can invoke them without importing
// the server-only supabase client transitively. Keep this file as a
// thin re-export — all the read logic stays in app/lib/config.ts.

import {
  getModule2ThresholdPct as _getModule2ThresholdPct,
  getHideModule2Path as _getHideModule2Path,
} from '@/app/lib/config';

export async function getModule2ThresholdPct(
  section: 'rw' | 'math',
): Promise<number> {
  return _getModule2ThresholdPct(section);
}

export async function getHideModule2Path(): Promise<boolean> {
  return _getHideModule2Path();
}
