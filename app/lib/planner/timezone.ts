// Planner timezone helper (#19, Trust & Coverage T2). PURE — no I/O, no
// Date.now() (callers pass the instant). Vercel serverless runs UTC, so the
// server-local "this week" boundary from the old `isoWeekStart` was wrong for a
// US student (the week flips over at an arbitrary local hour). This computes the
// UTC instant of the most recent Monday 00:00 *in the student's own IANA zone*.
//
// Implementation: `Intl.DateTimeFormat(..., { timeZone })` formatToParts gives us
// the wall-clock time in the target zone for any instant; the standard two-pass
// offset correction converts a desired wall-clock (Monday 00:00 local) back to a
// UTC instant, DST-safe to the hour. No new dependencies.

// Reads the zone's wall-clock parts for a given UTC instant and returns the
// zone's offset from UTC in minutes (local = utc + offset). Throws if `tz` is not
// a valid IANA name (Intl rejects it) — the caller catches and falls back to UTC.
function tzOffsetMinutes(instant: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(instant);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  // `hour: '2-digit'` with hour12:false can render midnight as "24" in some
  // engines — normalize to 0 so the reconstructed Date is well-formed.
  const hour = map.hour === 24 ? 0 : map.hour;
  // The wall-clock components, read as if they were UTC, minus the true UTC
  // instant, IS the zone's offset. (Both sides are ms-since-epoch of the same
  // "clock reading"; their difference is the offset the zone applied.)
  const asUtc = Date.UTC(
    map.year,
    map.month - 1,
    map.day,
    hour,
    map.minute,
    map.second,
  );
  return Math.round((asUtc - instant.getTime()) / 60000);
}

// Given a desired wall-clock (y/mo/d/h/m in the target zone), return the UTC
// instant that renders as that wall-clock in `tz`. Two-pass: guess the instant
// treating the wall-clock as UTC, measure the zone offset at that guess, correct,
// then re-measure once (handles the guess landing on the wrong side of a DST
// transition) and correct again if the offset moved.
function wallClockToUtc(
  tz: string,
  y: number,
  mo: number,
  d: number,
  h: number,
  min: number,
): Date {
  const wall = Date.UTC(y, mo - 1, d, h, min, 0);
  const off1 = tzOffsetMinutes(new Date(wall), tz);
  let utc = wall - off1 * 60000;
  const off2 = tzOffsetMinutes(new Date(utc), tz);
  if (off2 !== off1) {
    utc = wall - off2 * 60000;
  }
  return new Date(utc);
}

// The UTC ISO instant of the most recent Monday 00:00 in the given IANA zone.
// null/invalid tz → UTC fallback (the same computation with the zone forced to
// UTC — the previously-used server-local behavior is intentionally dropped). The
// result is always a valid ISO string and is always <= `nowIso`.
export function weekStartInTz(nowIso: string, tz: string | null): string {
  const now = new Date(nowIso);
  // If the caller handed us garbage, degrade to the epoch's week start rather
  // than emit `Invalid Date` — but a parseable ISO is the contract.
  const safeNow = Number.isNaN(now.getTime()) ? new Date(0) : now;

  const zone = tz && tz.length > 0 ? tz : 'UTC';

  // UTC is the trivial (offset-free) case — compute it directly and skip the
  // Intl parts / two-pass offset dance entirely.
  if (zone === 'UTC') return utcWeekStart(safeNow);

  // Read the zone's wall-clock calendar for `now`. A bad zone throws here → UTC.
  let y: number, mo: number, d: number, weekday: number;
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour12: false,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = dtf.formatToParts(safeNow);
    const map: Record<string, string> = {};
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = p.value;
    }
    y = Number(map.year);
    mo = Number(map.month);
    d = Number(map.day);
    // Map the short weekday name to a Mon=0 .. Sun=6 index.
    const WD: Record<string, number> = {
      Mon: 0,
      Tue: 1,
      Wed: 2,
      Thu: 3,
      Fri: 4,
      Sat: 5,
      Sun: 6,
    };
    weekday = WD[map.weekday];
    if (weekday === undefined || Number.isNaN(y)) throw new Error('bad parts');
  } catch {
    // Invalid tz (or any Intl failure) → UTC fallback.
    return utcWeekStart(safeNow);
  }

  // Roll the local calendar date back to this week's Monday, then anchor to
  // 00:00 in the zone and convert that wall-clock to a UTC instant.
  const monday = new Date(Date.UTC(y, mo - 1, d));
  monday.setUTCDate(monday.getUTCDate() - weekday);
  const utc = wallClockToUtc(
    zone,
    monday.getUTCFullYear(),
    monday.getUTCMonth() + 1,
    monday.getUTCDate(),
    0,
    0,
  );

  return utc.toISOString();
}

// Pure UTC week-start (Monday 00:00 UTC) — the fallback path when Intl rejects
// the zone. Kept separate so the fallback never re-enters the try/catch.
function utcWeekStart(now: Date): string {
  const d = new Date(now.getTime());
  d.setUTCHours(0, 0, 0, 0);
  // getUTCDay(): 0=Sun..6=Sat → days since Monday.
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d.toISOString();
}
