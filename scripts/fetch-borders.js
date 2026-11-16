// scripts/fetch-borders.js
//
// Downloads a list of which countries share a land border and saves it to
// data/borders.json. Used by the Border Chain game.
//
// Run it with:   npm run fetch-borders
//
// Run "npm run fetch-data" first: this script only keeps countries that are
// already in data/countries.json, so every game uses the same 195 countries.
//
// Source: the open "mledoze/countries" dataset on GitHub.

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SOURCE_URL =
  'https://raw.githubusercontent.com/mledoze/countries/master/countries.json';

// OUR RULINGS
//
// The game uses mainland borders only. The source data includes a few
// borders that only exist through a small overseas territory, so we remove
// them here. Each pair is two 2-letter ISO codes.
const REMOVED_BORDERS = [
  ['ES', 'MA'], // Spain-Morocco: only via Ceuta and Melilla, in North Africa
];

async function main() {
  const dataFolder = resolve(import.meta.dirname, '..', 'data');

  // ---- 1. Load our own list of countries ----------------------------------
  const ours = JSON.parse(
    await readFile(resolve(dataFolder, 'countries.json'), 'utf8')
  );
  const ourCodes = new Set(ours.countries.map((country) => country.iso2));

  // ---- 2. Download the borders dataset -------------------------------------
  console.log('Fetching borders...');
  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${SOURCE_URL}`);
  }
  const source = await response.json();

  // The dataset lists borders using 3-letter codes ("FRA"), but we use
  // 2-letter codes ("FR") everywhere else. Build a translator.
  const iso3ToIso2 = new Map(source.map((entry) => [entry.cca3, entry.cca2]));

  // ---- 3. Build our borders list -------------------------------------------
  // Start every one of our countries with an empty set of neighbours.
  // (A Set is a list that can't contain the same thing twice.)
  const borders = new Map();
  for (const code of ourCodes) borders.set(code, new Set());

  for (const entry of source) {
    if (!ourCodes.has(entry.cca2)) continue;

    for (const neighbour3 of entry.borders) {
      const neighbour = iso3ToIso2.get(neighbour3);
      // Skip neighbours that aren't in our 195 (e.g. Hong Kong, Gibraltar).
      if (!ourCodes.has(neighbour)) continue;

      // Record the border in BOTH directions, so if France borders Spain
      // then Spain definitely borders France.
      borders.get(entry.cca2).add(neighbour);
      borders.get(neighbour).add(entry.cca2);
    }
  }

  // Apply our rulings.
  for (const [a, b] of REMOVED_BORDERS) {
    borders.get(a)?.delete(b);
    borders.get(b)?.delete(a);
  }

  // ---- 4. Save --------------------------------------------------------------
  // Turn the Sets into sorted lists so the file is tidy and stable.
  const output = {};
  for (const code of [...borders.keys()].sort()) {
    output[code] = [...borders.get(code)].sort();
  }

  await writeFile(
    resolve(dataFolder, 'borders.json'),
    JSON.stringify(output, null, 1) + '\n'
  );

  // ---- 5. Print a little report ---------------------------------------------
  const withBorders = Object.values(output).filter((list) => list.length > 0);
  const totalBorders = withBorders.reduce((sum, list) => sum + list.length, 0) / 2;
  console.log(`\nSaved data/borders.json`);
  console.log(`  ${withBorders.length} countries have at least one land border`);
  console.log(`  ${ourCodes.size - withBorders.length} are islands with none`);
  console.log(`  ${totalBorders} borders in total`);
}

main().catch((error) => {
  console.error('\nSomething went wrong:', error.message);
  process.exit(1);
});
