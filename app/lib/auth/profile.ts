import { cache } from 'react';
import { createClient } from '@/app/lib/supabase/server';

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: 'student' | 'admin';
  created_at: string;
  updated_at: string;
}

// Returns the signed-in user's sat.profiles row, creating it on first access.
// Wrapped in cache() so the layout's <AppHeader/> and the page component
// collapse to a single execution per request. NOTE: requires the `sat` schema
// to be exposed in the Supabase project's API settings (spec §8).
export const getOrCreateProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const sat = supabase.schema('sat');

  const { data: existing } = await sat
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  if (existing) return existing as Profile;

  const meta = user.user_metadata ?? {};
  const { data: created, error } = await sat
    .from('profiles')
    .insert({
      id: user.id,
      email: user.email ?? null,
      full_name: meta.full_name ?? meta.name ?? null,
      avatar_url: meta.avatar_url ?? null,
    })
    .select('*')
    .single();

  if (error) {
    // A concurrent first-load may have inserted the row; re-select.
    // Log non-race failures (e.g. the `sat` schema not exposed in Supabase
    // API settings) — they would otherwise be silently invisible.
    console.error('[getOrCreateProfile] insert failed, re-selecting:', error.message);
    const { data: row } = await sat
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();
    return (row as Profile) ?? null;
  }
  return created as Profile;
});
