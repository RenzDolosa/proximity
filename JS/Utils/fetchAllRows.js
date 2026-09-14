// Supabase's PostgREST API enforces a default max rows per request
// (commonly 1000) server-side, independent of any .limit() the client
// asks for — so a table with more rows than that cap can't be fetched in
// a single call no matter what. This pages through with .range() in
// batches and concatenates the results, so callers get the true full set.
//
// `buildQuery(from, to)` must return a Supabase query with .range(from, to)
// applied (and whatever .select()/.order()/.eq() etc the caller needs) —
// see EmployeesModel.listDirectory for the usage pattern.
export async function fetchAllRows(buildQuery, pageSize = 1000) {
  let all = [];
  let from = 0;
  // Loop guard: bails out rather than spinning forever if something
  // (a misbehaving query, a server that ignores .range()) keeps returning
  // a full page without ever shrinking — 500 pages is 500,000+ rows at the
  // default pageSize, far beyond anything this app's tables should reach.
  for (let i = 0; i < 500; i++) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) return { data: null, error };
    if (!data || !data.length) break;
    all = all.concat(data);
    if (data.length < pageSize) break; // last page was short — nothing more to fetch
    from += pageSize;
  }
  return { data: all, error: null };
}
