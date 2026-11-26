// scripts/recheck-views.js
//
// Re-checks the fame of players ALREADY saved in a sport's data file,
// using their real two-year English Wikipedia page views. Use it when
// fetch-careers.js reports "N lookups failed and were estimated": those
// players were ranked from a 60-day count, which a burst of news can
// inflate hugely.
//
//   npm run recheck-views football
//   npm run recheck-views rugby
//
// Wikipedia only answers a few lookups every 10 seconds, so this is slow
// (about 30-40 minutes for 450 players). It saves its progress after every
// player in data/.recheck-<sport>.json. If it's stopped (or the computer is
// turned off), run the same command again and it carries on where it got
// to. The progress file is deleted once the data file has been updated.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sportName = process.argv[2];
if (!sportName) {
  console.error('Say which sport, e.g. "npm run recheck-views football"');
  process.exit(1);
}
const sport = (await import(`./sports/${sportName}.js`)).default;

const root = resolve(import.meta.dirname, '..');
const dataFile = resolve(root, 'data', sport.output);
const progressFile = resolve(root, 'data', `.recheck-${sportName}.json`);
const USER_AGENT = 'GuessItGames-data-script/1.0 (hobby quiz website)';
const VIEW_MONTHS = 24; // same as fetch-careers.js

const data = JSON.parse(readFileSync(dataFile, 'utf8'));

// Progress so far: each player's English title, number of language pages
// and (once looked up) their new fame.
const progress = existsSync(progressFile)
  ? JSON.parse(readFileSync(progressFile, 'utf8'))
  : { titles: {}, pages: {}, fame: {} };
const saveProgress = () => writeFileSync(progressFile, JSON.stringify(progress));

const wait = (seconds) => new Promise((done) => setTimeout(done, seconds * 1000));

// Fetches JSON, waiting as long as the server asks when it's busy.
// Returns null for "nothing recorded" and undefined if it never worked.
async function getJson(url) {
  for (let attempt = 1; attempt <= 10; attempt++) {
    let waitSeconds = 3 * attempt;
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(20000),
      });
      if (response.ok) return await response.json();
      if (response.status === 404) return null;
      const retryAfter = Number(response.headers.get('retry-after'));
      if (retryAfter > 0) waitSeconds = retryAfter + 1;
    } catch {
      // Connection dropped: wait and try again.
    }
    await wait(waitSeconds);
  }
  return undefined;
}

// 1. English titles and language counts from Wikidata, 50 players at a time.
const missing = data.players.filter((player) => !(player.id in progress.titles));
for (let i = 0; i < missing.length; i += 50) {
  const ids = missing.slice(i, i + 50).map((player) => player.id);
  const json = await getJson(
    'https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks&ids=' + ids.join('|'),
  );
  if (!json) throw new Error('Wikidata did not answer. Try again later.');
  for (const [id, entity] of Object.entries(json.entities)) {
    progress.titles[id] = entity.sitelinks?.enwiki?.title ?? null;
    progress.pages[id] = Object.keys(entity.sitelinks ?? {}).length;
  }
  saveProgress();
}

// 2. Two-year page views, one player at a time, saving after each.
const now = new Date();
const end = new Date(now.getFullYear(), now.getMonth() - 1, 1); // last full month
const start = new Date(end.getFullYear(), end.getMonth() - (VIEW_MONTHS - 1), 1);
const monthStart = (date) => `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}01`;

const todo = data.players.filter((player) => !(player.id in progress.fame));
console.log(`${data.players.length - todo.length} of ${data.players.length} already done, ${todo.length} to go`);

let failed = 0;
for (const [index, player] of todo.entries()) {
  if (index % 25 === 0) console.log(`  ${index}/${todo.length}...`);
  const title = progress.titles[player.id];
  if (!title) {
    failed++;
    continue;
  }
  const json = await getJson(
    'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/' +
      `${encodeURIComponent(title.replaceAll(' ', '_'))}/monthly/${monthStart(start)}/${monthStart(end)}`,
  );
  if (json === undefined) {
    failed++; // try again next run
    continue;
  }
  // The middle month times 24, as in fetch-careers.js.
  const monthly = (json?.items ?? []).map((month) => month.views).sort((a, b) => a - b);
  let fame = monthly.length ? monthly[Math.floor(monthly.length / 2)] * VIEW_MONTHS : 0;
  if (sport.fameIncludesLanguages) fame = Math.round((fame * progress.pages[player.id]) / 10);
  progress.fame[player.id] = fame;
  saveProgress();
}

if (failed > 0) {
  console.log(`${failed} players could not be looked up. Run the same command again to retry them.`);
  process.exit(1);
}

// 3. All done: update the data file and remove the progress file.
let bigChanges = 0;
for (const player of data.players) {
  const fame = progress.fame[player.id];
  if (Math.abs(fame - player.fame) > player.fame * 0.5) bigChanges++;
  player.fame = fame;
}
data.players.sort((a, b) => b.fame - a.fame);
writeFileSync(dataFile, JSON.stringify(data, null, 1) + '\n');
rmSync(progressFile);
console.log(`Updated ${sport.output}: ${bigChanges} players' fame changed by more than half.`);
