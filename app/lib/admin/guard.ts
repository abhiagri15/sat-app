import { notFound } from 'next/navigation';
import { getOrCreateProfile, type Profile } from '@/app/lib/auth/profile';

// Returns the signed-in user's profile if they are an admin; 404s otherwise.
// Used by the /admin layout and every admin server action — the gate never
// relies on UI reachability alone. notFound() is `never`, so the return
// narrows to a non-null admin Profile.
export async function requireAdmin(): Promise<Profile> {
  const profile = await getOrCreateProfile();
  if (!profile || profile.role !== 'admin') notFound();
  return profile;
}
