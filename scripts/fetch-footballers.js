// scripts/fetch-footballers.js
//
// Downloads famous footballers and their club careers from Wikidata (the
// free database behind Wikipedia) and saves them to data/footballers.json.
// Used by the Career Path game.
//
// Run it with:   npm run fetch-footballers
//
// Run it again each summer, after the transfer window, to pick up moves.
//
// HOW IT WORKS
//   1. Ask Wikidata for footballers with lots of Wikipedia pages (in
//      different languages). The number of pages is our "fame" score.
//   2. For those players, download every club they were at, with years.
//   3. Clean that up: drop youth teams, reserve teams and national teams.
//   4. Keep players whose last match was within the last 20 years.
//   5. Keep the 300 most famous, and split them into Easy, Medium and Hard.

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// ---- Settings you can change ------------------------------------------------

const PLAYER_COUNT = 300; // how many players end up in the game
const ERA_YEARS = 20; // players whose career ended longer ago are left out
const MIN_CLUBS = 1; // one-club legends like Totti count too

// Players to leave out by hand, with the reason. Fame is measured by the
// number of Wikipedia pages, and a few people score highly for other reasons.
const LEAVE_OUT = {
  'Javier Milei': 'a politician who played youth football',
  'Jason Statham': 'an actor, not a footballer',
  'Joao Grimaldo': 'far more pages than his fame suggests',
  'Percy Liza': 'far more pages than his fame suggests',
};
const MIN_SENIOR_AGE = 17; // club spells that ended before this age were youth football

// Wikidata's address for questions ("queries").
const ENDPOINT = 'https://query.wikidata.org/sparql';

// Wikidata asks scripts to say what they are. This is a generic name.
const USER_AGENT = 'GuessItGames-data-script/1.0 (hobby quiz website)';

// ---- Team names that are not a first team -----------------------------------
// Wikidata lists youth, reserve and national teams as clubs too. We spot
// them by their names, e.g. "Barcelona B", "Bayern Munich II", "Jong Ajax".
const NOT_A_FIRST_TEAM = [
  /\bnational\b/i, // "England national football team"
  /\bolympic\b/i,
  /\bunder[- ]?\d+/i, // "under-21"
  /\bU-?\d{2}\b/i, // "U21", "U-19"
  /\bsub-?\d{2}\b/i, // "Sub-20" (Spanish and Portuguese)
  /\b(reserves?|youth|academy|juvenil|juniors?|primavera|castilla)\b/i,
  /\batl[eè]tic\b/i, // "Barcelona Atlètic", Barcelona's second team
  /^jong\s/i, // "Jong Ajax", Dutch second teams
  /\s(B|C|II|III)$/, // "Sevilla B", "Bayern Munich II"
  /\bregional\b/i, // "Basque Country regional football team"
  /\bmestalla\b/i, // Valencia's second team
  /\bgeneration adidas\b/i, // a US training squad, not a club
  /\bautonomous\b/i, // "Asturias autonomous football team"
  /-2$/, // "Zenit-2", a Russian second team
  /\bsoccer\b/i, // US college teams: "Portland Pilots women's soccer"
];

// ---- Shorter club names -----------------------------------------------------
// Wikidata uses official names ("Real Madrid Club de Fútbol"). The game shows
// the names fans use. tidyClubName() below handles most clubs by trimming
// bits like "F.C." and "AFC". These are the ones it can't work out.
const CLUB_NAMES = {
  'Real Madrid Club de Fútbol': 'Real Madrid',
  'FC Bayern Munich': 'Bayern Munich',
  'AC Milan': 'AC Milan',
  'Olympique de Marseille': 'Marseille',
  'Olympique Lyonnais': 'Lyon',
  'Fenerbahçe Istanbul': 'Fenerbahçe',
  'Delfino Pescara 1936': 'Pescara',
  'Real Betis Balompié': 'Real Betis',
  'Feyenoord Rotterdam': 'Feyenoord',
  'Club Atlético River Plate': 'River Plate',
  'Clube Atlético Mineiro': 'Atlético Mineiro',
  'Clube de Regatas do Flamengo': 'Flamengo',
  'S.C. Corinthians Paulista': 'Corinthians',
  'Sociedade Esportiva Palmeiras': 'Palmeiras',
  'Club Social y Deportivo Colo-Colo': 'Colo-Colo',
  'Club Athletico Paranaense': 'Athletico Paranaense',
  'Deportivo de A Coruña': 'Deportivo La Coruña',
  'RCD Espanyol de Barcelona': 'Espanyol',
  'Stade Rennais F.C.': 'Rennes',
  'América Futebol Clube': 'América Mineiro',
  'Mogi Mirim Esporte Clube': 'Mogi Mirim',
  'Red Bull New York': 'New York Red Bulls',
  'Athletic Club': 'Athletic Bilbao',
  'Los Angeles FC': 'Los Angeles FC',
  'Club Nacional de Football': 'Nacional',
  'Grêmio FBPA': 'Grêmio',
  'Bayer 04 Leverkusen': 'Bayer Leverkusen',
  'Montpellier Hérault Sport Club': 'Montpellier',
  'AIK Fotboll': 'AIK',
  'Club Brugge K.V.': 'Club Brugge',
  'Shabab AlAhli Dubai Club': 'Shabab Al Ahli',
  'Wydad Athletic Club': 'Wydad Casablanca',
  'RC Strasbourg Alsace': 'Strasbourg',
  'RC Celta de Vigo': 'Celta Vigo',
  'Stade Malherbe Caen': 'Caen',
  'En Avant de Guingamp': 'Guingamp',
  'ES Troyes AC': 'Troyes',
  'İstanbul Başakşehir F.K.': 'İstanbul Başakşehir',
  'Sint-Truidense V.V.': 'Sint-Truiden',
  'Aarhus Gymnastikforening': 'AGF Aarhus',
  'Tours FC.': 'Tours',
  // Names that would otherwise clash with a more famous club.
  'Clube Atlético Juventus': 'Juventus (São Paulo)',
  'Barcelona Esporte Clube': 'Barcelona EC',
  'Nacional Atlético Clube': 'Nacional AC',
  'C.D. Nacional': 'Nacional (Madeira)',
  'Barcelona S.C.': 'Barcelona SC (Ecuador)',
  'Arsenal Fútbol Club': 'Arsenal de Sarandí',
  'E.C. Vitória': 'Vitória (Bahia)',
  'Vitória S.C.': 'Vitória de Guimarães',
  'Vitória F.C.': 'Vitória de Setúbal',
  'CD Málaga': 'CD Málaga',
  'Al Ahli SC': 'Al Ahli (Qatar)',
  'Al Ahli FC': 'Al Ahli (Saudi Arabia)',
};

// Trims official bits off a club's name:
//   "Manchester United F.C." -> "Manchester United"
//   "AFC Ajax"               -> "Ajax"
//   "Bologna F.C. 1909"      -> "Bologna"
function tidyClubName(official) {
  if (CLUB_NAMES[official]) return CLUB_NAMES[official];

  // Keep trimming until nothing more comes off, because some names have
  // several bits: "Ascoli Calcio 1898 FC" -> "Ascoli Calcio 1898" -> ...
  let name = official;
  let before;
  do {
    before = name;
    name = name
      .replace(TRIM_YEAR, '')
      .replace(TRIM_END, '')
      .replace(TRIM_START, '')
      .trim();
  } while (name !== before);

  // Never trim a name down to nothing, or to a single short word.
  return name.length >= 3 ? name : official;
}

// The bits tidyClubName() trims. "\s" means a space, "^" the start of the
// name and "$" the end. "\." is a full stop.
const TRIM_YEAR = /\s\d{4}$/; // a founding year: "Como 1907"
const TRIM_END = new RegExp(
  '\\s(' +
    [
      'F\\.\\s?C\\.?', 'A\\.F\\.C\\.', 'FC', 'CF', 'CFC', 'SC', 'S\\.C\\.', 'SFC',
      'OSC', 'UD', 'BC', 'FCO', 'PFC', 'K\\.V\\.', 'V\\.V\\.', 'S\\.K\\.', 'F\\.K\\.', 'FK',
      'J\\.K\\.', 'E\\.C\\.', 'F\\.R\\.', 'F\\.B\\.C\\.', 'S\\.S\\.', 'SAD', 'Calcio',
      'Football Club', 'Futebol Clube', 'Fútbol Club', 'Sports Club', 'Esporte Clube',
      'Atlético Clube', 'Futebol',
    ].join('|') +
    ')$'
);
const TRIM_START = new RegExp(
  '^(' +
    [
      'FC', 'F\\.C\\.', 'AFC', 'AS', 'A\\.S\\.', 'A\\.S\\.D\\.', 'ACF', 'SSC', 'SS',
      'U\\.C\\.', 'U\\.S\\.', 'US', 'S\\.L\\.', 'S\\.C\\.', 'SC', 'SBV', 'R\\.S\\.C\\.',
      'K\\.R\\.C\\.', 'K\\.S\\.K\\.', 'K\\.S\\.V\\.', 'A\\.C\\.', 'AC', 'AJ', 'GNK', 'HNK',
      'HŠK', 'NK', 'N\\.K\\.', 'OGC', 'RCD', 'RC', 'R\\.C\\.', 'SD', 'CD', 'C\\.D\\.',
      'C\\.A\\.', 'C\\.S\\.', 'CR', 'ES', 'E\\.C\\.', 'FK', 'PFC', 'P\\.A\\.S\\.', 'LB',
      'UD', 'SV', 'VfL', 'VfB', '1\\. FC', '1\\. FSV', 'TSG \\d{4}', 'Calcio',
      'Club Atlético', 'Clube Atlético', 'Esporte Clube', 'Sociedad Deportiva',
    ].join('|') +
    ')\\s'
);

// The four broad positions shown in the game, and words that point to each.
// Wikidata uses many detailed positions ("centre-back", "winger"...).
// Some Wikidata entries are odd ("10" for a playmaker, "wing half" for a
// winger), so those are included too. If nothing matches, the game simply
// doesn't show a position for that player.
const POSITIONS = [
  { name: 'Goalkeeper', words: ['goalkeeper'] },
  { name: 'Defender', words: ['defender', 'back', 'sweeper', 'libero'] },
  { name: 'Midfielder', words: ['midfield', 'playmaker', '10'] },
  { name: 'Forward', words: ['forward', 'striker', 'winger', 'wing'] },
];

// The home nations of the UK have their own flags but no country code.
// These are Wikidata's IDs for them, and flagcdn.com's flag names.
const HOME_NATIONS = {
  Q21: 'gb-eng', // England
  Q22: 'gb-sct', // Scotland
  Q25: 'gb-wls', // Wales
  Q26: 'gb-nir', // Northern Ireland
};

// ---- Talking to Wikidata ----------------------------------------------------

// Sends one question to Wikidata and returns the rows of the answer.
// Each row is an object like { player: '...', playerLabel: '...' }.
async function ask(query) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/sparql-results+json',
        'User-Agent': USER_AGENT,
      },
      body: new URLSearchParams({ query }),
    });

    if (response.ok) {
      try {
        const json = await response.json();
        // Flatten { player: { value: 'x' } } into { player: 'x' }.
        return json.results.bindings.map((row) => {
          const flat = {};
          for (const [key, cell] of Object.entries(row)) flat[key] = cell.value;
          return flat;
        });
      } catch {
        // When Wikidata runs out of time it can stop halfway through an
        // answer, which leaves broken JSON. Treat that like a busy server.
        console.log('  Wikidata sent a cut-off answer, retrying...');
      }
    } else {
      // Busy or too many requests.
      console.log(`  Wikidata said ${response.status}, retrying...`);
    }

    // Wait a bit (longer each time), then try again.
    await new Promise((done) => setTimeout(done, 5000 * attempt));
  }
  throw new Error('Wikidata did not answer after 3 tries.');
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

// ---- Step 1: famous footballers ---------------------------------------------

async function fetchCandidates() {
  console.log('Finding famous footballers...');
  // Q937857 = "association football player". P106 = occupation.
  // P569 = date of birth. Born 1966 or later rules out older careers early.
  // P21 = sex: men's football only for now (Q6581097 = male). Women's
  // football could become its own mode later.
  const rows = await ask(`
    SELECT ?player ?fame ?born WHERE {
      ?player wdt:P106 wd:Q937857 ;
              wdt:P21 wd:Q6581097 ;
              wikibase:sitelinks ?fame ;
              wdt:P569 ?born .
      FILTER(?fame >= 45)
      FILTER(YEAR(?born) >= 1966)
    }
    ORDER BY DESC(?fame)
    LIMIT 2500
  `);

  // A player can appear twice if Wikidata has two birth dates. Keep one.
  const players = new Map();
  for (const row of rows) {
    const id = idOf(row.player);
    if (!players.has(id)) {
      players.set(id, { id, fame: Number(row.fame), born: yearOf(row.born) });
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
    // P413 = position, P1532 = country for sport, P27 = citizenship.
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
    // (P1642), which tells us about loans.
    const clubs = await ask(`
      SELECT ?player ?statement ?team ?teamLabel ?start ?end ?howLabel WHERE {
        VALUES ?player { ${values} }
        ?player p:P54 ?statement .
        ?statement ps:P54 ?team .
        OPTIONAL { ?statement pq:P580 ?start . }
        OPTIONAL { ?statement pq:P582 ?end . }
        OPTIONAL { ?statement pq:P1642 ?how . }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
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
      });
    }
  }
}

// ---- Step 3: tidy up one player ---------------------------------------------

// Picks one broad position from Wikidata's detailed ones. Each detailed
// position is a "vote" for a broad one, and the most votes wins.
// ("attacking midfielder" contains "midfield", so it votes Midfielder.)
// A draw goes to the more attacking position, as that's usually what a
// player is known for.
function broadPosition(positions) {
  const votes = new Map();
  for (const label of positions ?? []) {
    const lower = label.toLowerCase();
    // The first broad position whose words match. Midfield is checked
    // before Forward so "attacking midfielder" counts as a midfielder.
    const match = POSITIONS.find(({ words }) => words.some((w) => lower.includes(w)));
    if (match) votes.set(match.name, (votes.get(match.name) ?? 0) + 1);
  }

  let best = null;
  for (const { name } of POSITIONS) {
    // ">=" means a later (more attacking) position wins a draw.
    if (votes.has(name) && (best === null || votes.get(name) >= votes.get(best))) {
      best = name;
    }
  }
  return best;
}

// Picks the nation the player represents, as { name, flag }.
// "Country for sport" is best (it says England, not United Kingdom). If a
// player has several, or none, we fall back to citizenship.
function pickNation(player) {
  const options = [...player.sportNations.entries()];
  if (options.length !== 1) options.push(...player.citizenships.entries());

  for (const [id, nation] of options) {
    const flag = HOME_NATIONS[id] ?? nation.code?.toLowerCase();
    if (flag) return { name: nation.name, flag };
  }
  return null;
}

function isFirstTeam(name) {
  return !NOT_A_FIRST_TEAM.some((pattern) => pattern.test(name));
}

// Turns a player's raw memberships into a clean career, oldest first.
// Returns null if the career has gaps we can't trust.
function cleanCareer(player) {
  const spells = [...(player.spells?.values() ?? [])]
    // A spell with no years at all is almost always a childhood club.
    .filter((spell) => spell.from || spell.to)
    // No English name means Wikidata just gives us its ID ("Q12345").
    .filter((spell) => !/^Q\d+$/.test(spell.name))
    .filter((spell) => isFirstTeam(spell.name))
    // Spells that ended before age 17 were youth football.
    .filter((spell) => !(spell.to && spell.to - player.born < MIN_SENIOR_AGE))
    // Spells starting after 40 are usually charity or exhibition games.
    .filter((spell) => !(spell.from && spell.from - player.born > 40));

  // Every spell needs a start year, otherwise we can't put them in order.
  if (spells.length === 0 || spells.some((spell) => !spell.from)) return null;

  spells.sort((a, b) => a.from - b.from || (a.to ?? 9999) - (b.to ?? 9999));

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

// ---- Main -------------------------------------------------------------------

async function main() {
  const players = await fetchCandidates();
  await fetchDetails(players);

  const thisYear = new Date().getFullYear();
  const oldestFinish = thisYear - ERA_YEARS;
  const reasons = { name: 0, leaveOut: 0, nation: 0, career: 0, era: 0, clubs: 0 };
  const kept = [];
  const leftOut = []; // for the optional report, see the bottom of main()

  // Notes why a player was left out.
  function skip(player, reason) {
    reasons[reason]++;
    leftOut.push({ name: player.name, fame: player.fame, reason });
  }

  for (const player of players.values()) {
    if (!player.name || /^Q\d+$/.test(player.name)) { skip(player, 'name'); continue; }
    if (LEAVE_OUT[player.name]) { skip(player, 'leaveOut'); continue; }

    // May be null: the game then just doesn't show a position.
    const position = broadPosition(player.positions);

    const nation = pickNation(player);
    if (!nation) { skip(player, 'nation'); continue; }

    const career = cleanCareer(player);
    if (!career) { skip(player, 'career'); continue; }

    // Era check: still playing, or finished within the last 20 years.
    // Look at every club, not just the last in the list, because a loan
    // can sit in the middle of a long spell (Lahm: Bayern 2002-2017, with
    // a loan to Stuttgart 2003-2005).
    const openSpells = career.filter((spell) => spell.to === null);
    const lastYear = Math.max(...career.map((spell) => spell.to ?? 0));
    // A "current" club that started long ago is usually just missing its
    // end date, so it doesn't count as still playing.
    const stillPlaying = openSpells.some((spell) => spell.from >= oldestFinish - 5);
    if (!stillPlaying && lastYear < oldestFinish) { skip(player, 'era'); continue; }

    if (career.length < MIN_CLUBS) { skip(player, 'clubs'); continue; }

    kept.push({
      id: player.id,
      name: player.name,
      born: player.born,
      position,
      nation,
      fame: player.fame,
      clubs: career.map(({ name, from, to, loan }) => ({
        name: tidyClubName(name),
        from,
        to,
        ...(loan ? { loan: true } : {}),
      })),
    });
  }

  // Most famous first, then keep the top 300 and split into thirds.
  kept.sort((a, b) => b.fame - a.fame);
  const chosen = kept.slice(0, PLAYER_COUNT);
  const third = Math.ceil(chosen.length / 3);
  chosen.forEach((player, index) => {
    player.difficulty = index < third ? 'easy' : index < third * 2 ? 'medium' : 'hard';
  });

  const output = {
    source: 'Wikidata (https://www.wikidata.org), CC0',
    fetchedOn: new Date().toISOString().slice(0, 10),
    players: chosen,
  };

  await writeFile(
    resolve(import.meta.dirname, '..', 'data', 'footballers.json'),
    JSON.stringify(output, null, 1) + '\n'
  );

  // ---- Report ----
  console.log(`\nSaved ${chosen.length} players to data/footballers.json`);
  console.log('Left out because of:', reasons);
  console.log(`Fame range: ${chosen[0]?.fame} down to ${chosen.at(-1)?.fame}`);

  // Optional: "node scripts/fetch-footballers.js report.json" also saves the
  // most famous players that were left out, and why, to check by hand.
  if (process.argv[2]) {
    leftOut.sort((a, b) => b.fame - a.fame);
    const raw = Object.fromEntries(
      [...players.values()].slice(0, 400).map((p) => [
        p.name,
        {
          positions: [...(p.positions ?? [])],
          spells: [...(p.spells?.values() ?? [])],
        },
      ])
    );
    await writeFile(process.argv[2], JSON.stringify({ leftOut: leftOut.slice(0, 150), raw }, null, 1));
  }

  // Warn if two different clubs ended up with the same short name, so one
  // can be given its own entry in CLUB_NAMES.
  const officialBySortName = new Map();
  for (const player of players.values()) {
    for (const spell of player.spells?.values() ?? []) {
      const short = tidyClubName(spell.name);
      if (!officialBySortName.has(short)) officialBySortName.set(short, new Set());
      officialBySortName.get(short).add(spell.name);
    }
  }
  const usedNames = new Set(chosen.flatMap((p) => p.clubs.map((c) => c.name)));
  for (const [short, officials] of officialBySortName) {
    if (officials.size > 1 && usedNames.has(short)) {
      console.log(`  Name clash: "${short}" is used for ${[...officials].join(' / ')}`);
    }
  }
}

main().catch((error) => {
  console.error('\nSomething went wrong:', error.message);
  process.exit(1);
});
