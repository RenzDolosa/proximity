// Turns a pg_stat_statements query text into something a human can act on.
//
// Every PostgREST statement opens with the same wrapper —
// `WITH pgrst_source AS (SELECT "pgrst_call".* FROM …` — so Settings' Query
// performance table showed nine identical rows and the one column that was
// supposed to say WHICH query is slow said nothing at all. The RPC name is in
// there, a little past where the cell clips.
//
// SECURITY NOTE, because this feeds innerHTML.
//
// Nothing here escapes anything; callers must still run the result through
// esc(). What this does instead is refuse to CLASSIFY anything that isn't
// shaped like a plain Postgres identifier. A quoted identifier may legally
// contain `<`, a quote, or a newline, so "it came from the database" is not a
// reason to trust it — pg_stat_statements records the text of statements that
// FAILED too, which is the one way odd text could plausibly get in.
//
// The whitelist below is therefore the point, not a formality: anything that
// doesn't match falls through to `kind: 'raw'` and the caller renders the SQL
// exactly as it does today. Recognising a row strictly REDUCES what reaches
// the page — a name instead of 500 characters of schema, columns and
// predicates — so the worst case of a parse miss is the status quo.

// Unquoted-identifier shape, capped at Postgres's NAMEDATALEN - 1.
const IDENT = '[a-z_][a-z0-9_]{0,62}';

// PostgREST's own scaffolding, never a relation the reader cares about.
const INTERNAL = new Set([
  'pgrst_source', 'pgrst_payload', 'pgrst_body', 'pgrst_call', 'pgrst_scalar',
  'pgrst_args', 'pgrst_uniq', 'pgrst_affected_rows',
]);

const rx = (body, flags = 'i') => new RegExp(body.replace(/IDENT/g, IDENT), flags);

// `"public"."name"(` — the function call PostgREST builds for an RPC. Also
// accepts the unquoted `public.name(` that a service_role caller or a cron
// job writes by hand. The trailing `(` is what separates a function from a
// relation of the same name.
const FUNCTION_CALL = rx('(?:"(IDENT)"|(IDENT))\\s*\\.\\s*(?:"(IDENT)"|(IDENT))\\s*\\(', 'gi');

// Relation references, identified by the verb in front of them.
//
// WRITES ARE CHECKED BEFORE FUNCTION_CALL, and that ordering is load-bearing.
// PostgREST writes `INSERT INTO "public"."employees"("full_name", …)` — the
// column list's opening paren sits exactly where a function call's argument
// list would, so `"public"."employees"(` is indistinguishable from a call to
// a function named employees. The leading verb is the only thing that
// disambiguates, so it has to win. A plain `FROM` is checked last instead,
// because an RPC wrapper legitimately contains both.
const WRITES = [
  ['insert', rx('INSERT\\s+INTO\\s+(?:"(IDENT)"|(IDENT))\\s*\\.\\s*(?:"(IDENT)"|(IDENT))')],
  ['update', rx('UPDATE\\s+(?:"(IDENT)"|(IDENT))\\s*\\.\\s*(?:"(IDENT)"|(IDENT))')],
  ['delete', rx('DELETE\\s+FROM\\s+(?:"(IDENT)"|(IDENT))\\s*\\.\\s*(?:"(IDENT)"|(IDENT))')],
];
const READ = rx('FROM\\s+(?:"(IDENT)"|(IDENT))\\s*\\.\\s*(?:"(IDENT)"|(IDENT))');

// Last resort before giving up and printing SQL: a schema-qualified COLUMN
// reference, `"public"."employee_directory"."full_name"` or `…".*`.
//
// get_slow_query_stats() returns left(query, 500), and PostgREST enumerates
// every selected column fully qualified. The employee_directory read names
// fifteen columns that way, which runs past 500 characters BEFORE the FROM
// clause — so the one query most worth identifying was the one that always
// fell through to raw SQL. The relation name is still right there in the
// select list.
const QUALIFIED_COLUMN = rx('"(IDENT)"\\s*\\.\\s*"(IDENT)"\\s*\\.\\s*(?:"|\\*)', 'gi');

// Prose, deliberately not SQL keywords — the tooltip should read as a
// description of the row, not as a fragment of the statement it replaced.
const PHRASE = {
  insert: 'Insert into', update: 'Update of', delete: 'Delete from', select: 'Read from',
};

// Each pattern has four capture groups — quoted and unquoted, schema and name
// — because a regex alternation can't share one group between branches.
const pair = (m) => ({ schema: m[1] ?? m[2], name: m[3] ?? m[4] });

const usable = ({ schema, name }) =>
  schema === 'public' && !!name && !INTERNAL.has(name) && !name.startsWith('pgrst_');

/**
 * @param {string} sql raw query text from pg_stat_statements
 * @returns {{kind: 'rpc'|'select'|'insert'|'update'|'delete'|'raw', label: string, title: string}}
 *   `label` is what to show in the cell, `title` what to show on hover.
 *   Both still need escaping. For every kind except 'raw' the SQL itself is
 *   deliberately absent from both.
 */
export function describeQuery(sql) {
  const text = typeof sql === 'string' ? sql : '';
  const raw = { kind: 'raw', label: text, title: text };
  if (!text) return raw;

  const relation = (kind, m) => {
    const p = pair(m);
    return usable(p)
      ? { kind, label: `${kind} ${p.name}`, title: `${PHRASE[kind]} public.${p.name}` }
      : null;
  };

  for (const [kind, re] of WRITES) {
    const m = text.match(re);
    const hit = m && relation(kind, m);
    if (hit) return hit;
  }

  // Last match, not first: a POST'd RPC puts its payload CTEs ahead of the
  // call, and those can carry casts that look like calls. The user function
  // is always the final one in PostgREST's wrapper.
  let fn = null;
  for (const m of text.matchAll(FUNCTION_CALL)) {
    const p = pair(m);
    if (usable(p)) fn = p;
  }
  if (fn) return { kind: 'rpc', label: `${fn.name}()`, title: `RPC: public.${fn.name}()` };

  const read = text.match(READ);
  const hit = read && relation('select', read);
  if (hit) return hit;

  // Truncated before its FROM. Reported as a read because the writes above
  // are matched on an explicit verb and none of them fired — an INSERT or
  // UPDATE names its target in the first few words, so it cannot be truncated
  // out the way a select list can.
  for (const m of text.matchAll(QUALIFIED_COLUMN)) {
    const p = { schema: m[1], name: m[2] };
    if (!usable(p)) continue;
    return { kind: 'select', label: `select ${p.name}`, title: `${PHRASE.select} public.${p.name}` };
  }

  // Deliberately the whole statement. An unrecognised shape is the one case
  // where an admin needs the text to work out what they are looking at, and
  // this is what the panel showed for every row before.
  return raw;
}
