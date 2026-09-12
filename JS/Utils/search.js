// Postgrest's `.or()` filter syntax uses commas to separate conditions and
// `%`/`_`/`*` have special meaning inside ilike patterns. A raw search term
// containing any of those would either break the filter string or match
// something the person didn't intend — strip them before building a query.
export function sanitizeSearchTerm(term) {
  return (term || '').trim().replace(/[,%_*]/g, ' ').replace(/\s+/g, ' ').trim();
}
