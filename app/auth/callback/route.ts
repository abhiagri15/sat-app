import { NextResponse } from 'next/server';
import { createClient } from '@/app/lib/supabase/server';

// Exchanges the OAuth / email-link `code` for a session, then redirects
// into the app. Used by Google sign-in and the password-reset email link.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const nextParam = searchParams.get('next') ?? '/';
  // Only allow same-origin absolute paths; reject protocol-relative (//host).
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
