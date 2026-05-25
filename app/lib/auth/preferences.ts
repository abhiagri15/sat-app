'use server';

import { createClient } from '@/app/lib/supabase/server';
import { revalidatePath } from 'next/cache';

// Toggle the per-user "hide Module 2 path while testing" preference.
// Writes via the user's own client (RLS on sat.profiles allows the
// signed-in user to update their own row). Sub-project #11 follow-up.
export async function setHideModule2Path(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) throw new Error('Not authenticated.');
  const hide = formData.get('hide') === 'on';
  const { error } = await supabase
    .schema('sat')
    .from('profiles')
    .update({ hide_module2_path: hide })
    .eq('id', userData.user.id);
  if (error) {
    console.error('[setHideModule2Path] failed:', error);
    throw new Error('Failed to update preference.');
  }
  revalidatePath('/');
  revalidatePath('/dashboard');
}
