// Passage highlight geometry — pure interval helpers (sub-project #17, spec §A).
//
// A highlight is a half-open character interval `[start, end)` over the
// passage's PLAIN TEXT (see QuestionView's text-node walker for how offsets are
// derived from the DOM). `start` is inclusive, `end` is exclusive — so an empty
// interval has `start === end` and adjacent intervals `[2,5)` and `[5,9)` touch
// without overlapping (and MERGE, per spec). All helpers are total and
// side-effect-free; they never mutate their inputs. Covered by
// `scripts/check-highlights.ts`.

export interface Interval {
  start: number; // inclusive
  end: number; // exclusive
}

// Normalize a list of intervals into a sorted, non-overlapping, non-adjacent
// canonical form. Overlapping OR touching intervals (end === next.start) are
// merged into one. Empty/degenerate intervals (start >= end) are dropped.
// Order in the output is ascending by start.
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const valid = intervals
    .filter((iv) => iv.end > iv.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const iv of valid) {
    const last = out[out.length - 1];
    // `<=` (not `<`) so ADJACENT intervals merge: [2,5) + [5,9) -> [2,9).
    if (last && iv.start <= last.end) {
      if (iv.end > last.end) last.end = iv.end;
    } else {
      out.push({ start: iv.start, end: iv.end });
    }
  }
  return out;
}

// Add one interval to a set, clamping it to `[0, textLength]` first, then
// merging. A fully out-of-bounds or collapsed-to-empty addition is a no-op
// (returns the existing set, re-merged into canonical form).
export function addInterval(
  intervals: Interval[],
  add: Interval,
  textLength: number,
): Interval[] {
  const start = Math.max(0, Math.min(add.start, textLength));
  const end = Math.max(0, Math.min(add.end, textLength));
  if (end <= start) return mergeIntervals(intervals);
  return mergeIntervals([...intervals, { start, end }]);
}

// Remove the single (already-merged) interval that contains `pos`. `pos` is a
// character offset; an interval `[start, end)` contains it when
// `start <= pos < end`. If no interval contains `pos`, the set is unchanged
// (returned in canonical form). Because the input is expected to be merged,
// at most one interval can match — clicking anywhere on a highlight removes the
// whole merged run.
export function removeIntervalAt(intervals: Interval[], pos: number): Interval[] {
  const merged = mergeIntervals(intervals);
  return merged.filter((iv) => !(pos >= iv.start && pos < iv.end));
}

// A run of passage text plus whether it is highlighted. Concatenating every
// segment's `text` reconstructs the original `text` exactly (round-trip).
export interface Segment {
  text: string;
  highlighted: boolean;
}

// Split `text` into alternating plain / highlighted segments from the interval
// list. Intervals are merged + clamped to `[0, text.length]` first, so the
// output always alternates (no two consecutive segments share a `highlighted`
// value) and the concatenated `text`s equal the input. An empty interval list
// yields a single un-highlighted segment (or, for empty text, an empty array).
export function segmentText(text: string, intervals: Interval[]): Segment[] {
  const merged = mergeIntervals(
    intervals
      .map((iv) => ({
        start: Math.max(0, Math.min(iv.start, text.length)),
        end: Math.max(0, Math.min(iv.end, text.length)),
      }))
      .filter((iv) => iv.end > iv.start),
  );
  if (text.length === 0) return [];
  const out: Segment[] = [];
  let cursor = 0;
  for (const iv of merged) {
    if (iv.start > cursor) {
      out.push({ text: text.slice(cursor, iv.start), highlighted: false });
    }
    out.push({ text: text.slice(iv.start, iv.end), highlighted: true });
    cursor = iv.end;
  }
  if (cursor < text.length) {
    out.push({ text: text.slice(cursor), highlighted: false });
  }
  return out;
}
