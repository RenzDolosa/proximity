// Ranking for the command palette (Ctrl/Cmd+K).
//
// COSTS NOTHING. It searches appState.employeesCache — the directory rows
// Employee Manager already fetched — and the route list, both already on the
// client. It answers while offline, which a server-side search could not.
//
// Pure and DOM-free so the ranking is unit-tested rather than eyeballed
// against 814 names.

export const MAX_RESULTS = 8;

// Rank bands, not a score formula. With 814 people the difference that
// matters is WHY something matched, not by how much: typing "24" should put
// code 2400 above "Marion De Jesus 2409" every time, and a formula with
// weights makes that a coincidence rather than a rule.
const RANK = { codeExact: 0, codePrefix: 1, namePrefix: 2, wordPrefix: 3, contains: 4 };

const norm = (v) => String(v ?? '').trim().toLowerCase();

function rankText(haystack, needle) {
  if (!haystack) return null;
  if (haystack === needle) return RANK.codeExact;
  if (haystack.startsWith(needle)) return RANK.namePrefix;
  // Word-start, so "dela" finds "Zar Dela Cruz" without also matching
  // every name that happens to contain the letters.
  if (haystack.split(/\s+/).some((w) => w.startsWith(needle))) return RANK.wordPrefix;
  return haystack.includes(needle) ? RANK.contains : null;
}

function rankEmployee(row, needle) {
  const code = norm(row?.employee_code);
  const card = norm(row?.active_proximity_code);
  if (code && code === needle) return RANK.codeExact;
  if (card && card === needle) return RANK.codeExact;
  if (code && code.startsWith(needle)) return RANK.codePrefix;
  if (card && card.startsWith(needle)) return RANK.codePrefix;

  const byName = rankText(norm(row?.full_name), needle);
  if (byName !== null) return byName;
  // Department and position are searchable but never outrank a name: they
  // match in bulk, and a hundred equally-good hits is the same as none.
  const other = rankText(norm(row?.department), needle) ?? rankText(norm(row?.position), needle);
  return other === null ? null : RANK.contains;
}

function rankRoute(route, titles, needle) {
  const [title, sub] = titles[route] || [route, ''];
  return rankText(norm(title), needle) ?? (norm(sub).includes(needle) ? RANK.contains : null);
}

/**
 * @param {object} o
 * @param {string} o.query          what was typed
 * @param {Array}  o.employees      appState.employeesCache
 * @param {Array}  o.routes         routes this account can actually reach
 * @param {object} o.titles         ROUTE_TITLES
 * @returns {Array<{kind:'route'|'employee', ...}>} at most MAX_RESULTS
 */
export function searchPalette({ query, employees = [], routes = [], titles = {} } = {}) {
  const needle = norm(query);
  // Empty query offers destinations, not 8 arbitrary people out of 814.
  if (!needle) {
    return routes.slice(0, MAX_RESULTS).map((route) => ({
      kind: 'route', route, label: (titles[route] || [route])[0], hint: (titles[route] || ['', ''])[1],
    }));
  }

  const hits = [];
  for (const route of routes) {
    const rank = rankRoute(route, titles, needle);
    if (rank !== null) {
      hits.push({
        kind: 'route', route, rank,
        label: (titles[route] || [route])[0], hint: (titles[route] || ['', ''])[1],
      });
    }
  }
  for (const row of Array.isArray(employees) ? employees : []) {
    const rank = rankEmployee(row, needle);
    if (rank === null) continue;
    hits.push({
      kind: 'employee', rank, id: row.id, row,
      label: String(row.full_name ?? 'Unnamed'),
      hint: [row.employee_code, row.department].filter(Boolean).join(' · '),
    });
  }

  return hits
    .sort((a, b) => a.rank - b.rank
      // Routes before people at the same rank: there are twelve of one and
      // 814 of the other, so a tie that buried the route would never surface.
      || (a.kind === b.kind ? 0 : a.kind === 'route' ? -1 : 1)
      || a.label.localeCompare(b.label))
    .slice(0, MAX_RESULTS);
}

/** Wraps at both ends, so Down on the last item returns to the first. */
export function moveSelection(index, delta, length) {
  if (!length) return 0;
  return ((index + delta) % length + length) % length;
}
