import { NextResponse } from 'next/server';
import { runGeneration } from '@/app/lib/ai/generate';

// Cron-triggered question generation. Vercel Cron issues GET and (when
// CRON_SECRET is set in the project) sends `Authorization: Bearer <CRON_SECRET>`.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  // Fail closed: if CRON_SECRET is unset, reject everything (never accept the
  // literal header "Bearer undefined").
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const summary = await runGeneration();
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    console.error('[generate-questions] failed', e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
