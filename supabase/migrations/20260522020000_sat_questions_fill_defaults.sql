-- Auto-fill id + dedup_hash on sat.questions inserts that omit them.
--
-- The in-app generator and the seed script supply id and dedup_hash
-- explicitly; this trigger only fills them when NULL — so an external
-- generator (the n8n question-generation workflow) can insert a question
-- without re-implementing the dedup-hash algorithm. Existing callers that
-- supply the values are unaffected.
--
-- The hash replicates app/lib/ai/dedup.ts dedupHash(): lowercase, collapse
-- whitespace, trim each of passage/prompt/choices, join with U+241F, SHA-256
-- of the UTF-8 bytes, hex-encoded.

create or replace function sat.questions_fill_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_basis text;
begin
  if new.id is null then
    new.id := 'ai-' || gen_random_uuid();
  end if;

  if new.dedup_hash is null then
    v_basis :=
      lower(btrim(regexp_replace(coalesce(new.passage, ''), '[[:space:]]+', ' ', 'g')))
      || chr(9247)
      || lower(btrim(regexp_replace(coalesce(new.prompt, ''), '[[:space:]]+', ' ', 'g')))
      || coalesce((
           select string_agg(
                    chr(9247) || lower(btrim(regexp_replace(c.val, '[[:space:]]+', ' ', 'g'))),
                    '' order by c.ord)
           from jsonb_array_elements_text(new.choices) with ordinality as c(val, ord)
         ), '');
    new.dedup_hash := encode(sha256(convert_to(v_basis, 'UTF8')), 'hex');
  end if;

  return new;
end;
$$;

drop trigger if exists questions_fill_defaults on sat.questions;
create trigger questions_fill_defaults
  before insert on sat.questions
  for each row execute function sat.questions_fill_defaults();
