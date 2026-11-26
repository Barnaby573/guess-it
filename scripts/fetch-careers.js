// scripts/fetch-careers.js
//
// Downloads famous players and their club careers from Wikidata (the free
// database behind Wikipedia) and saves them to the data folder. Used by
// the Career Path games.
//
// Works for any sport. Each sport has its own settings file in
// scripts/sports/ (which teams to ignore, how to shorten club names...).
//
// Run it with:   npm run fetch-footballers
//           or:  npm run fetch-rugby
//
// HOW IT WORKS
//   1. Ask Wikidata for players with Wikipedia pages in several languages,
//      as a first list of candidates.
//   2. For those players, download every club they were at, with years.
//   3. Clean that up: drop youth, reserve and national teams, and keep
//      players whose last match was within the last 30 years.
//   4. Measure fame: how often each player's English Wikipedia page was
//      viewed over the last two years.
//   5. Keep the most famous, and save the year each one stopped playing.
//
// The game does the rest: it keeps only players from the time frame you
// pick (last 10, 15, 20 or 30 years), then splits them into Easy, Medium
// and Hard by fame.

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { applyWikipediaSpells, fetchWikipediaSpells } from './wikipedia-careers.js';

// ---- Which sport? -----------------------------------------------------------
// "node scripts/fetch-careers.js rugby" loads scripts/sports/rugby.js.
const sportName = process.argv[2];
if (!sportName) {
  console.error('Say which sport, e.g.  node scripts/fetch-careers.js football');
  process.exit(1);
}
const sport = (await import(`./sports/${sportName}.js`)).default;

// ---- Settings shared by every sport -----------------------------------------

// Players whose career ended longer ago are left out. This must be at
// least as long as the longest time frame in the game
// (games/career-path/career-game.js).
const ERA_YEARS = 30;

// Fame = how many times the player's English Wikipedia page was viewed
// over this many months. Two years smooths out short spikes (a big
// transfer, a World Cup) while still favouring players people know now.
const VIEW_MONTHS = 24;

// How many players get the slower, more accurate two-year count: twice
// as many as end up in the game (900 footballers, 600 rugby players).
const SHORTLIST = sport.playerCount * 2;

const MIN_SENIOR_AGE = 17; // club spells that ended before this age were youth sport

// Wikidata's address for questions ("queries").
const ENDPOINT = 'https://query.wikidata.org/sparql';

// Wikidata asks scripts to say what they are. This is a generic name.
const USER_AGENT = 'GuessItGames-data-script/1.0 (hobby quiz website)';

// The home nations of the UK have their own flags but no country code.
// These are Wikidata's IDs for them, and flagcdn.com's flag names.
const HOME_NATIONS = {
  Q21: 'gb-eng', // England
  Q22: 'gb-sct', // Scotland
  Q25: 'gb-wls', // Wales
  Q26: 'gb-nir', // Northern Ireland
};

// ---- Shorter club names -----------------------------------------------------

// The bits tidyClubName() trims, built from the sport's settings.
// "\s" means a space, "^" the start of the name and "$" the end.
const TRIM_YEAR = /\s\d{4}$/; // a founding year: "Como 1907"
const TRIM_BRACKETS = /\s\([^)]*\)$/; // "Crusaders (rugby union)"
const TRIM_END = new RegExp(`\\s(${sport.trimEnd.join('|')})$`);
const TRIM_START = new RegExp(`^(${sport.trimStart.join('|')})\\s`);

// Trims official bits off a club's name:
//   "Manchester United F.C." -> "Manchester United"
//   "AFC Ajax"               -> "Ajax"
//   "Leinster Rugby"         -> "Leinster"
function tidyClubName(official) {
  if (sport.clubNames[official]) return sport.clubNames[official];

  // Keep trimming until nothing more comes off, because some names have
  // several bits: "Ascoli Calcio 1898 FC" -> "Ascoli Calcio 1898" -> ...
  let name = official;
  let before;
  do {
    before = name;
    name = name
      .replace(TRIM_BRACKETS, '')
      .replace(TRIM_YEAR, '')
      .replace(TRIM_END, '')
      .replace(TRIM_START, '')
      .trim();
  } while (name !== before);

  // Never trim a name down to nothing, or to a single short word.
  return name.length >= 3 ? name : official;
}

// ---- Talking to Wikidata ----------------------------------------------------

// Sends one question to Wikidata and returns the rows of the answer.
// Each row is an object like { player: '...', playerLabel: '...' }.
async function ask(query) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/sparql-results+json',
          'User-Agent': USER_AGENT,
        },
        body: new URLSearchParams({ query }),
        // Wikidata stops long questions after 60 seconds itself, so 90
        // seconds is plenty. Without a limit a hung connection waits forever.
        signal: AbortSignal.timeout(90000),
      });

      if (response.ok) {
        const json = await response.json();
        // Flatten { player: { value: 'x' } } into { player: 'x' }.
        return json.results.bindings.map((row) => {
          const flat = {};
          for (const [key, cell] of Object.entries(row)) flat[key] = cell.value;
          return flat;
        });
      }
      // Busy or too many requests.
      console.log(`  Wikidata said ${response.status}, retrying...`);
    } catch {
      // The connection dropped, or Wikidata ran out of time and stopped
      // halfway through an answer (which leaves broken JSON).
      console.log('  Wikidata answer was cut off, retrying...');
    }

    // Wait a bit (longer each time), then try again.
    await new Promise((done) => setTimeout(done, 5000 * attempt));
  }
  throw new Error('Wikidata did not answer after 4 tries.');
}

// "http://www.wikidata.org/entity/Q615" -> "Q615"
const idOf = (url) => url.split('/').pop();

// "2004-07-01T00:00:00Z" -> 2004
const yearOf = (date) => (date ? Number(date.slice(0, 4)) : null);

// Splits a list into chunks of a given size (Wikidata copes better with
// several medium questions than one enormous one).
function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// ---- Step 1: candidates -----------------------------------------------------

async function fetchCandidates() {
  console.log(`Finding famous ${sport.label}...`);
  // P106 = occupation. P569 = date of birth. Nobody born more than 42
  // years before the start of our time frame was still playing in it, so
  // they're ruled out early. P21 = sex: men only for now (Q6581097 = male).
  //
  // "pages" is how many Wikipedias (in different languages) have a page on
  // the player. It's only used here to find candidates. The real fame
  // score comes later, from English Wikipedia page views (step 4).
  // ?enTitle is the title of their English Wikipedia page, needed for that.
  const rows = await ask(`
    SELECT ?player ?pages ?born ?enTitle WHERE {
      ?player wdt:P106 wd:${sport.occupation} ;
              wdt:P21 wd:Q6581097 ;
              wikibase:sitelinks ?pages ;
              wdt:P569 ?born .
      FILTER(?pages >= ${sport.minPages})
      FILTER(YEAR(?born) >= ${new Date().getFullYear() - ERA_YEARS - 42})
      ?article schema:about ?player ;
               schema:isPartOf <https://en.wikipedia.org/> ;
               schema:name ?enTitle .
    }
    ORDER BY DESC(?pages)
    LIMIT 4000
  `);

  // A player can appear twice if Wikidata has two birth dates. Keep one.
  const players = new Map();
  for (const row of rows) {
    const id = idOf(row.player);
    if (!players.has(id)) {
      players.set(id, {
        id,
        pages: Number(row.pages),
        enTitle: row.enTitle,
        born: yearOf(row.born),
        fame: 0, // filled in from page views later
      });
    }
  }
  console.log(`  ${players.size} candidates`);
  return players;
}

// ---- Step 2: details for each player ----------------------------------------

async function fetchDetails(players) {
  const ids = [...players.keys()];
  const batches = chunks(ids, 150);

  for (const [index, batch] of batches.entries()) {
    console.log(`Downloading careers ${index + 1}/${batches.length}...`);
    const values = batch.map((id) => `wd:${id}`).join(' ');

    // Name, positions and nationality.
    // P413 = position, P1532 = country for sport, P27 = citizenship,
    // P297 = a country's two-letter code.
    const info = await ask(`
      SELECT ?player ?playerLabel ?positionLabel ?sportNation ?sportNationLabel
             ?sportNationCode ?citizen ?citizenLabel ?citizenCode WHERE {
        VALUES ?player { ${values} }
        OPTIONAL { ?player wdt:P413 ?position . }
        OPTIONAL { ?player wdt:P1532 ?sportNation .
                   OPTIONAL { ?sportNation wdt:P297 ?sportNationCode . } }
        OPTIONAL { ?player wdt:P27 ?citizen .
                   OPTIONAL { ?citizen wdt:P297 ?citizenCode . } }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      }
    `);

    for (const row of info) {
      const player = players.get(idOf(row.player));
      player.name = row.playerLabel;
      player.positions ??= new Set();
      player.sportNations ??= new Map();
      player.citizenships ??= new Map();
      if (row.positionLabel) player.positions.add(row.positionLabel);
      if (row.sportNation) {
        player.sportNations.set(idOf(row.sportNation), {
          name: row.sportNationLabel,
          code: row.sportNationCode,
        });
      }
      if (row.citizen) {
        player.citizenships.set(idOf(row.citizen), {
          name: row.citizenLabel,
          code: row.citizenCode,
        });
      }
    }

    // Clubs. P54 = "member of sports team". Each membership can carry the
    // dates it started (P580) and ended (P582), and how the player joined
    // (P1642), which tells us about loans. P17 = the team's country, which
    // gives a player's nation from their national team.
    //
    // "en,mul": the English name, or failing that the club's default name
    // (some clubs, like the Sharks, have no English name on Wikidata).
    const clubs = await ask(`
      SELECT ?player ?statement ?team ?teamLabel ?start ?end ?howLabel
             ?country ?countryLabel ?countryCode WHERE {
        VALUES ?player { ${values} }
        ?player p:P54 ?statement .
        ?statement ps:P54 ?team .
        OPTIONAL { ?statement pq:P580 ?start . }
        OPTIONAL { ?statement pq:P582 ?end . }
        OPTIONAL { ?statement pq:P1642 ?how . }
        OPTIONAL { ?team wdt:P17 ?country .
                   OPTIONAL { ?country wdt:P297 ?countryCode . } }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
      }
    `);

    for (const row of clubs) {
      const player = players.get(idOf(row.player));
      player.spells ??= new Map();
      // One row per membership. Several rows can share one if it has two
      // start dates, so the first one wins.
      const key = row.statement;
      if (player.spells.has(key)) continue;
      player.spells.set(key, {
        team: idOf(row.team),
        name: row.teamLabel,
        from: yearOf(row.start),
        to: yearOf(row.end),
        loan: /loan/i.test(row.howLabel ?? ''),
        country: row.country
          ? { id: idOf(row.country), name: row.countryLabel, code: row.countryCode }
          : null,
      });
    }
  }
}

// ---- Step 3: tidy up one player ---------------------------------------------

// Picks one position from Wikidata's detailed ones. Each detailed position
// is a "vote" for one of the sport's positions, and the most votes wins.
// ("attacking midfielder" contains "midfield", so it votes Midfielder.)
// A draw goes to the position later in the sport's list.
function pickPosition(labels) {
  const votes = new Map();
  for (const label of labels ?? []) {
    const lower = label.toLowerCase();
    // The first position in the list whose words match.
    const match = sport.positions.find(({ words }) => words.some((w) => lower.includes(w)));
    if (match) votes.set(match.name, (votes.get(match.name) ?? 0) + 1);
  }

  let best = null;
  for (const { name } of sport.positions) {
    if (votes.has(name) && (best === null || votes.get(name) >= votes.get(best))) {
      best = name;
    }
  }
  return best;
}

// Turns a Wikidata country into { name, flag }, or null if it has no flag.
function toNation(id, name, code) {
  if (sport.nationOverrides[id]) return sport.nationOverrides[id];
  const flag = HOME_NATIONS[id] ?? code?.toLowerCase();
  return flag ? { name, flag } : null;
}

// England, Scotland and Wales teams are often listed with the United
// Kingdom as their country, so their names say which nation they are.
const HOME_NATION_TEAMS = [
  { pattern: /^England\b/, nation: { name: 'England', flag: 'gb-eng' } },
  { pattern: /^Scotland\b/, nation: { name: 'Scotland', flag: 'gb-sct' } },
  { pattern: /^Wales\b/, nation: { name: 'Wales', flag: 'gb-wls' } },
];

// Picks the nation the player represents, as { name, flag }.
function pickNation(player) {
  // Some sports: the country of the senior national team they played for.
  if (sport.nationFromNationalTeam) {
    for (const spell of player.spells?.values() ?? []) {
      const senior = /national/i.test(spell.name) && isFirstTeamExceptNational(spell.name);
      if (!senior) continue;
      const home = HOME_NATION_TEAMS.find(({ pattern }) => pattern.test(spell.name));
      if (home) return home.nation;
      if (spell.country) {
        const nation = toNation(spell.country.id, spell.country.name, spell.country.code);
        if (nation) return nation;
      }
    }
  }

  // Otherwise "country for sport" (it says England, not United Kingdom).
  // If a player has several, or none, fall back to citizenship.
  const options = [...player.sportNations.entries()];
  if (options.length !== 1) options.push(...player.citizenships.entries());
  for (const [id, nation] of options) {
    const result = toNation(id, nation.name, nation.code);
    if (result) return result;
  }
  return null;
}

function isFirstTeam(name) {
  return !sport.notAFirstTeam.some((pattern) => pattern.test(name));
}

// True for a senior national team ("Wales national rugby union team"),
// false for "Wales national under-20 rugby union team" and the like.
function isFirstTeamExceptNational(name) {
  return !sport.notAFirstTeam.some(
    (pattern) => pattern.source !== '\\bnational\\b' && pattern.test(name)
  );
}

// Turns a player's raw memberships into a clean career, oldest first.
// Returns null if the career has gaps we can't trust.
function cleanCareer(player) {
  const spells = [...(player.spells?.values() ?? [])]
    // A spell with no years at all is almost always a childhood club.
    .filter((spell) => spell.from || spell.to)
    // No name at all means Wikidata just gives us its ID ("Q12345").
    .filter((spell) => !/^Q\d+$/.test(spell.name))
    .filter((spell) => isFirstTeam(spell.name))
    // Spells that ended before age 17 were youth sport.
    .filter((spell) => !(spell.to && spell.to - player.born < MIN_SENIOR_AGE))
    // Spells starting after 40 are usually charity or exhibition games.
    .filter((spell) => !(spell.from && spell.from - player.born > 40));

  if (spells.length === 0) return null;

  // Put them in order of when they started. A spell with only an end year
  // is placed by that year instead (the game shows its start as "?").
  const startOf = (spell) => spell.from ?? spell.to;
  spells.sort((a, b) => startOf(a) - startOf(b) || (a.to ?? 9999) - (b.to ?? 9999));

  // Join back-to-back spells at the same club (Wikidata sometimes splits
  // one spell in two, e.g. when a contract was renewed).
  const career = [];
  for (const spell of spells) {
    const last = career.at(-1);
    if (last && last.team === spell.team && last.loan === spell.loan) {
      last.to = spell.to === null || last.to === null ? null : Math.max(last.to, spell.to);
    } else {
      career.push({ ...spell });
    }
  }
  return career;
}

// ---- Step 4: fame from page views -------------------------------------------
// Asks Wikipedia how often each player's English page was viewed, and
// stores it as player.fame. This matches what English-speaking fans know
// much better than counting pages in other languages, which made some
// players look far more famous than they are in the UK.

let failedLookups = 0; // counted for the report at the end

// Fetches a web address and returns its JSON, retrying if the connection
// drops or the server is busy. Returns null if it never works.
async function getJson(url) {
  for (let attempt = 1; attempt <= 10; attempt++) {
    let waitSeconds = 3 * attempt;
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        // Give up on this try after 20 seconds. Without a limit, one
        // connection that hangs would freeze the whole script.
        signal: AbortSignal.timeout(20000),
      });
      if (response.ok) return await response.json();
      if (response.status === 404) return null; // nothing recorded
      // 429 = "too many requests". The server says how long to wait
      // ("Retry-After", in seconds), so wait that long plus a second.
      const retryAfter = Number(response.headers.get('retry-after'));
      if (retryAfter > 0) waitSeconds = retryAfter + 1;
    } catch {
      // Connection dropped. Fall through to wait and retry.
    }
    await new Promise((done) => setTimeout(done, waitSeconds * 1000));
  }
  failedLookups++;
  return null;
}

// "2026-11-23" -> "20261101", the first of that month, as the API wants it.
function monthStart(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}01`;
}

// Two-year views for one player, or null if the lookup failed.
async function viewsFor(title) {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() - 1, 1); // last full month
  const start = new Date(end.getFullYear(), end.getMonth() - (VIEW_MONTHS - 1), 1);
  const url =
    'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/' +
    `${encodeURIComponent(title.replaceAll(' ', '_'))}/monthly/${monthStart(start)}/${monthStart(end)}`;

  const json = await getJson(url);
  if (!json || json.items.length === 0) return null;

  // Use the MIDDLE month (the "median"), not the total. One freak month,
  // like a viral clip or a burst of automated traffic, can't then push a
  // player to the top. Times the number of months, so it reads like a total.
  const monthly = json.items.map((month) => month.views).sort((a, b) => a - b);
  return monthly[Math.floor(monthly.length / 2)] * VIEW_MONTHS;
}

// Quick first pass: views over the last 60 days, asking about 50 players
// at a time. Returns a Map of title -> views.
async function recentViews(titles) {
  const views = new Map();
  const batches = chunks(titles, 50);
  for (const [index, batch] of batches.entries()) {
    if (index % 10 === 0) console.log(`  recent views ${index + 1}/${batches.length}...`);
    const base =
      'https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2' +
      '&prop=pageviews&pvipdays=60&redirects=1&titles=' +
      encodeURIComponent(batch.join('|'));

    // Wikipedia sends the answer in parts. Each part says how to ask for
    // the next one ("continue"), until there are no more. At most 10
    // parts, so a server that keeps saying "there's more" can't make the
    // script loop forever.
    let more = {};
    for (let part = 0; more && part < 10; part++) {
      const json = await getJson(`${base}&${new URLSearchParams(more)}`);
      if (!json) break;

      // Wikipedia may tidy a title or follow a redirect, so work out which
      // of our titles each answer belongs to.
      const renamed = new Map();
      for (const { from, to } of [...(json.query.normalized ?? []), ...(json.query.redirects ?? [])]) {
        renamed.set(to, from);
      }
      for (const page of json.query.pages) {
        let title = page.title;
        while (renamed.has(title)) title = renamed.get(title);
        const total = Object.values(page.pageviews ?? {}).reduce((sum, n) => sum + (n ?? 0), 0);
        views.set(title, (views.get(title) ?? 0) + total);
      }
      more = json.continue ?? null;
    }
  }
  return views;
}

async function fetchPageViews(players) {
  // 1. Quick 60-day count for everyone, to make a shortlist.
  console.log(`Fetching recent page views for ${players.length} players...`);
  const recent = await recentViews(players.map((player) => player.enTitle));
  for (const player of players) player.fame = recent.get(player.enTitle) ?? 0;

  // Retired players get fewer views, so the shortlist also keeps the top
  // retired players, not just the top overall.
  players.sort((a, b) => b.fame - a.fame);
  const shortlist = new Set(players.slice(0, SHORTLIST));
  const retired = players.filter((player) => player.lastYear !== null);
  for (const player of retired.slice(0, SHORTLIST / 3)) shortlist.add(player);

  // 2. Accurate two-year count for the shortlist, 2 players at a time.
  //    Wikipedia limits how fast this can be asked, so more at once only
  //    means more "too many requests, wait" answers.
  console.log(`Fetching two-year page views for ${shortlist.size} players...`);
  const queue = [...shortlist];
  let next = 0;
  async function worker() {
    while (next < queue.length) {
      const player = queue[next++];
      if (next % 100 === 0) console.log(`  two-year views ${next}/${queue.length}...`);
      const views = await viewsFor(player.enTitle);
      // If the lookup failed, estimate from the 60-day count instead
      // (60 days x 12 is about two years).
      player.fame = views ?? player.fame * 12;
    }
  }
  await Promise.all(Array.from({ length: 2 }, worker));
  if (failedLookups > 0) console.log(`  ${failedLookups} lookups failed and were estimated`);

  // Anyone not on the shortlist drops to the bottom.
  for (const player of players) if (!shortlist.has(player)) player.fame = 0;

  // Some sports also count how many languages of Wikipedia have a page on
  // the player (see "fameIncludesLanguages" in the sport's settings).
  // Players known mainly from TV in one country then rank below players
  // known around the world for the sport itself.
  if (sport.fameIncludesLanguages) {
    for (const player of players) player.fame = Math.round((player.fame * player.pages) / 10);
  }
}

// ---- Main -------------------------------------------------------------------

async function main() {
  const players = await fetchCandidates();
  await fetchDetails(players);

  const thisYear = new Date().getFullYear();
  const oldestFinish = thisYear - ERA_YEARS;
  const reasons = { name: 0, leaveOut: 0, nation: 0, career: 0, era: 0 };
  const kept = [];
  const leftOut = []; // for the optional report, see the bottom of main()

  // Notes why a player was left out.
  function skip(player, reason) {
    reasons[reason]++;
    leftOut.push({ name: player.name, pages: player.pages, reason });
  }

  for (const player of players.values()) {
    if (!player.name || /^Q\d+$/.test(player.name)) { skip(player, 'name'); continue; }
    if (sport.leaveOut[player.name]) { skip(player, 'leaveOut'); continue; }

    // May be null: the game then just doesn't show a position.
    const position = pickPosition(player.positions);

    const nation = sport.nationFixes[player.name] ?? pickNation(player);
    if (!nation) { skip(player, 'nation'); continue; }

    const career = cleanCareer(player);
    if (!career) { skip(player, 'career'); continue; }

    // When did they stop playing? Look at every club, not just the last in
    // the list, because a loan can sit in the middle of a long spell
    // (Lahm: Bayern 2002-2017, with a loan to Stuttgart 2003-2005).
    //
    // A club with no end year means "still there". But if the player is
    // over 42, the end year is almost certainly just missing, so we count
    // the year they joined instead. (Age is a better test than how long
    // ago they joined: Akinfeev has been at CSKA Moscow since 2003.)
    //
    // When an older player's end year is missing, guess that they stopped
    // at 35, a typical age to retire (but not before they joined, and not
    // in the future). Heaslip: joined Leinster in 2005, born 1983 -> 2018.
    const isCurrent = (spell) => spell.to === null && player.born >= thisYear - 42;
    const stillPlaying = career.some(isCurrent);
    const guessedEnd = (spell) => Math.min(thisYear, Math.max(spell.from, player.born + 35));
    const lastYear = stillPlaying
      ? null // null in the saved file means "still playing"
      : Math.max(...career.map((spell) => spell.to ?? guessedEnd(spell)));
    if (!stillPlaying && lastYear < oldestFinish) { skip(player, 'era'); continue; }

    kept.push({
      id: player.id,
      name: player.name,
      born: player.born,
      position,
      nation,
      enTitle: player.enTitle, // used for page views below, then removed
      pages: player.pages, // the same
      lastYear,
      clubs: career.map(({ name, from, to, loan }) => ({
        name: tidyClubName(name),
        from,
        to,
        ...(loan ? { loan: true } : {}),
      })),
    });
  }

  // Most famous first, then keep the top ones. (The game splits them into
  // Easy, Medium and Hard itself, once it knows the time frame.)
  await fetchPageViews(kept);
  kept.sort((a, b) => b.fame - a.fame);
  let chosen = kept.slice(0, sport.playerCount);

  // Some sports' end years are mostly missing on Wikidata, so read them
  // from each player's Wikipedia info box (see wikipedia-careers.js).
  // A player can then turn out to have stopped before the era starts.
  if (sport.endYearsFromWikipedia) {
    console.log('Checking end years on Wikipedia...');
    const spells = await fetchWikipediaSpells(chosen.map((player) => player.enTitle));
    const decided = { current: 0, retired: 0, unknown: 0 };
    for (const player of chosen) {
      decided[applyWikipediaSpells(player, spells.get(player.enTitle), thisYear)]++;
    }
    console.log('  From Wikipedia:', decided);
    chosen = chosen.filter((player) => player.lastYear === null || player.lastYear >= oldestFinish);
  }

  for (const player of chosen) {
    delete player.enTitle;
    delete player.pages;
  }

  const output = {
    source: 'Wikidata (https://www.wikidata.org), CC0',
    fetchedOn: new Date().toISOString().slice(0, 10),
    players: chosen,
  };

  await writeFile(
    resolve(import.meta.dirname, '..', 'data', sport.output),
    JSON.stringify(output, null, 1) + '\n'
  );

  // ---- Report ----
  console.log(`\nSaved ${chosen.length} players to data/${sport.output}`);
  console.log('Left out because of:', reasons);
  console.log(`Fame range: ${chosen[0]?.fame} down to ${chosen.at(-1)?.fame}`);

  // Optional: "node scripts/fetch-careers.js rugby report.json" also saves
  // the players that were left out, and why, to check by hand.
  if (process.argv[3]) {
    leftOut.sort((a, b) => b.pages - a.pages);
    await writeFile(process.argv[3], JSON.stringify({ leftOut: leftOut.slice(0, 200) }, null, 1));
  }

  // Warn if two different clubs ended up with the same short name, so one
  // can be given its own entry in the sport's clubNames.
  const officialsByShortName = new Map();
  for (const player of players.values()) {
    for (const spell of player.spells?.values() ?? []) {
      const short = tidyClubName(spell.name);
      if (!officialsByShortName.has(short)) officialsByShortName.set(short, new Set());
      officialsByShortName.get(short).add(spell.name);
    }
  }
  const usedNames = new Set(chosen.flatMap((p) => p.clubs.map((c) => c.name)));
  for (const [short, officials] of officialsByShortName) {
    if (officials.size > 1 && usedNames.has(short)) {
      console.log(`  Name clash: "${short}" is used for ${[...officials].join(' / ')}`);
    }
  }
}

main().catch((error) => {
  console.error('\nSomething went wrong:', error.message);
  process.exit(1);
});
