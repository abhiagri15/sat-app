import { createHash } from 'crypto';

// Normalized exact-duplicate hash of a question's content.
// Lowercase, collapse whitespace; join passage + prompt + choices (order preserved).
// `passage` is included so two questions that differ only in passage are not
// treated as duplicates.
export function dedupHash(prompt: string, choices: string[], passage?: string): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const basis = [norm(passage ?? ''), norm(prompt), ...choices.map(norm)].join('␟');
  return createHash('sha256').update(basis).digest('hex');
}
