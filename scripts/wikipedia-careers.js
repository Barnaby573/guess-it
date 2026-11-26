// scripts/wikipedia-careers.js
//
// Wikidata often never gets an end year when a player retires. For rugby
// that's most players: Johnny Sexton's last spell at Leinster still reads
// "2015 to now" there, years after he retired. So the game would treat him
// as a current player, and show "2015–" on his clue card.
//
// The info box at the top of a player's English Wikipedia page is much
// better kept up to date. Its club years look like this:
//
//   | years3 = 2015–2023        <- a finished spell
//   | clubs3 = [[Leinster Rugby|Leinster]]
//   | years6 = 2026–            <- still there
//
// This file reads those years and uses them to fill in the missing end
// years. Used by fetch-careers.js for sports that set
// "endYearsFromWikipedia" (see scripts/sports/rugby.js).

const USER_AGENT = 'GuessItGames-data-script/1.0 (hobby quiz website)';

// Info box fields with years in them that are NOT senior club spells.
const NOT_CLUB_YEARS = /youth|rep|coach|national|amateur|school|univ|college|sevens|junior|referee/i;

async function getJson(url) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(30000),
      });
      if (response.ok) return await response.json();
      const retryAfter = Number(response.headers.get('retry-after'));
      await new Promise((done) => setTimeout(done, (retryAfter > 0 ? retryAfter + 1 : 3 * attempt) * 1000));
    } catch {
      await new Promise((done) => setTimeout(done, 3000 * attempt));
    }
  }
  return null;
}

// "2005–2023" -> { from: 2005, to: 2023 }   "2026–" -> { from: 2026, to: null }
// "2023" -> { from: 2023, to: 2023 }         anything else -> null
function parseYears(value) {
  const text = value
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[\s\S]*?<\/ref>/g, '')
    .replace(/&ndash;|&mdash;|\{\{(?:snd|ndash)\}\}/gi, '–');
  const range = text.match(/(\d{4})\s*(?:[–—-]|to)\s*(\d{4}|\d{2}|present|current)?/i);
  if (range) {
    const from = Number(range[1]);
    let to = range[2];
    if (!to || /present|current/i.test(to)) return { from, to: null };
    if (to.length === 2) to = String(from).slice(0, 2) + to; // "2005–06"
    return { from, to: Number(to) };
  }
  const single = text.match(/^\s*(\d{4})\s*$/);
  return single ? { from: Number(single[1]), to: Number(single[1]) } : null;
}

// The senior club spells in a page's info box, or null if there's no info
// box or it lists no club years.
function spellsFromPage(wikitext) {
  // "{{Infobox rugby biography" (sometimes written "{{infobox ...").
  const start = wikitext.search(/\{\{\s*infobox/i);
  if (start < 0) return null;

  // The info box's fields, e.g. { years1: '2005–2023', clubs1: '...' }.
  // Only the top of the page is read, where the info box sits.
  const fields = {};
  for (const line of wikitext.slice(start, start + 20000).split('\n')) {
    const field = line.match(/^\s*\|\s*([\w]+)\s*=\s*(.*)$/);
    if (field && !(field[1] in fields)) fields[field[1]] = field[2].trim();
  }

  const spells = [];
  for (const [name, value] of Object.entries(fields)) {
    if (NOT_CLUB_YEARS.test(name)) continue;

    // Rugby union layout: "years3 = 2015–2023" (also province_years3,
    // super_years3...).
    if (/years[a-z_]*\d*$/i.test(name)) {
      const years = parseYears(value);
      if (years) spells.push(years);
    }

    // Rugby league layout, used for players who played both codes:
    // "year3start = 2015" and "year3end = 23". "present" means still
    // there, and a blank end means just the one season.
    const league = name.match(/^((?:ru_)?year\d+)start$/i);
    if (league && /^\d{4}$/.test(value)) {
      const from = Number(value);
      const endText = fields[`${league[1]}end`] ?? '';
      const end = endText.match(/\d{2,4}/)?.[0];
      let to = from;
      if (/present|current/i.test(endText)) to = null;
      else if (end) to = Number(end.length === 2 ? String(from).slice(0, 2) + end : end);
      spells.push({ from, to });
    }
  }
  return spells.length > 0 ? spells : null;
}

// Reads the info box spells for many pages, 50 at a time.
// Returns a Map of title -> spells (or null).
export async function fetchWikipediaSpells(titles) {
  const found = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    console.log(`  Wikipedia info boxes ${i + 1}-${Math.min(i + 50, titles.length)} of ${titles.length}...`);
    const batch = titles.slice(i, i + 50);
    const json = await getJson(
      'https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2' +
        '&prop=revisions&rvprop=content&rvslots=main&redirects=1&titles=' +
        encodeURIComponent(batch.join('|')),
    );
    if (!json) continue; // that batch keeps its Wikidata years

    // Wikipedia may tidy a title or follow a redirect: map answers back.
    const renamed = new Map();
    for (const { from, to } of [...(json.query.normalized ?? []), ...(json.query.redirects ?? [])]) {
      renamed.set(to, from);
    }
    for (const page of json.query.pages) {
      let title = page.title;
      while (renamed.has(title)) title = renamed.get(title);
      const wikitext = page.revisions?.[0]?.slots?.main?.content;
      found.set(title, wikitext ? spellsFromPage(wikitext) : null);
    }
  }
  return found;
}

// Uses the info box spells to settle whether a player is still playing,
// and to fill in end years Wikidata is missing. Changes the player
// (lastYear and clubs) and returns what it decided:
//   'current'   - the info box has a spell with no end: still playing
//   'retired'   - every info box spell has ended
//   'unknown'   - no info box years, so the Wikidata years stand
export function applyWikipediaSpells(player, spells, thisYear) {
  if (!spells) return 'unknown';

  // Over 42 with a spell "still going" means the page is out of date.
  if (spells.some((spell) => spell.to === null) && player.born >= thisYear - 42) {
    player.lastYear = null;
    return 'current';
  }

  const finished = spells.filter((spell) => spell.to !== null);
  if (finished.length === 0) return 'unknown';
  const lastOnWikipedia = Math.max(...finished.map((spell) => spell.to));

  // Close each spell Wikidata left open, using the info box spell that
  // started the same year (give or take one), or else the last end year.
  // The closest start wins, then the longest spell: Alun Wyn Jones joined
  // the Ospreys in 2005 (2005–2023), not Swansea (2004–2006).
  for (const club of player.clubs) {
    if (club.to !== null) continue;
    const match = finished
      .filter((spell) => club.from !== null && Math.abs(spell.from - club.from) <= 1)
      .sort((a, b) => Math.abs(a.from - club.from) - Math.abs(b.from - club.from) || b.to - a.to)[0];
    club.to = Math.max(match ? match.to : lastOnWikipedia, club.from ?? 0);
  }
  player.lastYear = Math.max(lastOnWikipedia, ...player.clubs.map((club) => club.to));
  return 'retired';
}
