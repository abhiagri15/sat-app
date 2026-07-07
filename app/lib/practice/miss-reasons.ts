// Single source of truth for the miss-reason enum (#18). The zod union, the six
// UI chips, and the guidance prompt phrasing all derive from this const — only
// the SQL CHECK constraint (in 20260707060000_sat_planner.sql) duplicates the
// value set (note beside the SKILLS two-places gotcha). Keep the `value`s here
// byte-for-byte in sync with that CHECK.
//
//   value        — persisted on the response row's `miss_reason` column.
//   label        — the one-tap chip label shown to the student.
//   promptPhrase — the short phrase surfaced to the coach ("student's own
//                  read: <promptPhrase>") when this reason is present.

export interface MissReasonEntry {
  value: string;
  label: string;
  promptPhrase: string;
}

export const MISS_REASONS = [
  { value: 'concept', label: "Didn't know the concept", promptPhrase: "didn't know the concept" },
  { value: 'careless', label: 'Careless slip', promptPhrase: 'a careless slip' },
  { value: 'time_pressure', label: 'Ran out of time', promptPhrase: 'ran out of time' },
  { value: 'misread', label: 'Misread it', promptPhrase: 'misread the question' },
  { value: 'setup', label: 'Set it up wrong', promptPhrase: 'set it up wrong' },
  { value: 'vocab', label: 'Vocabulary', promptPhrase: 'a vocabulary gap' },
] as const;

// The closed set of valid miss-reason values, derived from MISS_REASONS.
export const MISS_REASON_VALUES = MISS_REASONS.map((r) => r.value) as readonly string[];

// Union of the valid miss-reason values ('concept' | 'careless' | ...).
export type MissReason = (typeof MISS_REASONS)[number]['value'];
