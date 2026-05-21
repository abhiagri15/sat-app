'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/app/lib/supabase/server';

// Server action: clears the Supabase session cookie and returns to /login.
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
