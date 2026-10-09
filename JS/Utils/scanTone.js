// Which colour a scan reads as from across the room.
//
// Pure and separate from Components/ScanFeed.js because that module imports
// the Supabase client, which needs a browser — this rule is worth testing,
// and getting it wrong is worse than having no colour at all: a red row on a
// normal IN sends someone to check nothing.
//
// Direction is what the feed is actually read for, so it drives the colour.
// Anything that did not match is a problem regardless of direction.
export function feedTone(row) {
  if (row?.result !== 'matched') return 'feed-bad';
  return row.direction === 'out' ? 'feed-out' : 'feed-in';
}
