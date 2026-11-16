// scripts/fetch-data.js
//
// Downloads country statistics from the free World Bank API and saves them
// to data/countries.json.
//
// Run it with:   npm run fetch-data
//
// You only need to run this occasionally (e.g. once a year when new data
// comes out). The game itself reads the saved JSON file and never talks to
// the API, so the live site stays fast and works without a backend.

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const API = 'https://api.worldbank.org/v2';

// The stats we want. "key" is the name we use in our JSON file,
// "code" is the World Bank's indicator code.
const INDICATORS = [
  { key: 'population', code: 'SP.POP.TOTL' },
  { key: 'gdp', code: 'NY.GDP.MKTP.CD' },
  { key: 'gdpPerCapita', code: 'NY.GDP.PCAP.CD' },
  { key: 'area', code: 'AG.LND.TOTL.K2' },
  { key: 'lifeExpectancy', code: 'SP.DYN.LE00.IN' },
  { key: 'density', code: 'EN.POP.DNST' },
];

// Only look at data from this year onwards. Anything older is too stale
// to be fair to guess, so a country with only older data for a stat simply
// sits out that category. The API is happy if the end year has no data yet.
const FIRST_YEAR = 2020;
const LAST_YEAR = new Date().getFullYear();

// The World Bank also lists territories that are not independent countries
// (e.g. Puerto Rico, Greenland, Hong Kong). We leave these out so the game
// only uses the 193 UN member states plus Kosovo and Palestine.
// These are 2-letter ISO codes. Delete a code from this list to bring that
// territory back into the game.
const EXCLUDED_TERRITORIES = new Set([
  'AS', // American Samoa (US)
  'AW', // Aruba (Netherlands)
  'BM', // Bermuda (UK)
  'VG', // British Virgin Islands (UK)
  'KY', // Cayman Islands (UK)
  'JG', // Channel Islands (UK)
  'CW', // Curacao (Netherlands)
  'FO', // Faroe Islands (Denmark)
  'PF', // French Polynesia (France)
  'GI', // Gibraltar (UK)
  'GL', // Greenland (Denmark)
  'GU', // Guam (US)
  'HK', // Hong Kong (China)
  'IM', // Isle of Man (UK)
  'MO', // Macao (China)
  'NC', // New Caledonia (France)
  'MP', // Northern Mariana Islands (US)
  'PR', // Puerto Rico (US)
  'SX', // Sint Maarten (Netherlands)
  'MF', // St. Martin (France)
  'TC', // Turks and Caicos Islands (UK)
  'VI', // Virgin Islands (US)
]);

// The World Bank's official names can be awkward ("Korea, Rep."), so we
// swap in the names people actually use. Keyed by 2-letter ISO code.
const FRIENDLY_NAMES = {
  BS: 'The Bahamas',
  BN: 'Brunei',
  CV: 'Cape Verde',
  CD: 'DR Congo',
  CG: 'Republic of the Congo',
  CI: 'Ivory Coast',
  EG: 'Egypt',
  GM: 'The Gambia',
  IR: 'Iran',
  KP: 'North Korea',
  KR: 'South Korea',
  KG: 'Kyrgyzstan',
  LA: 'Laos',
  FM: 'Micronesia',
  NR: 'Nauru',
  PS: 'Palestine',
  RU: 'Russia',
  ST: 'São Tomé and Príncipe',
  SK: 'Slovakia',
  SO: 'Somalia',
  KN: 'Saint Kitts and Nevis',
  LC: 'Saint Lucia',
  VC: 'Saint Vincent and the Grenadines',
  SY: 'Syria',
  TR: 'Turkey',
  VE: 'Venezuela',
  VN: 'Vietnam',
  YE: 'Yemen',
};

// The World Bank API returns results in "pages". Every response is an
// array of two things: [pageInfo, rows]. This helper keeps asking for the
// next page until it has all the rows.
async function fetchAllPages(path, extraParams = '') {
  const rows = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const url = `${API}/${path}?format=json&per_page=1000&page=${page}${extraParams}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Request failed (${response.status}): ${url}`);
    }

    const [pageInfo, pageRows] = await response.json();
    if (!pageRows) {
      throw new Error(`Unexpected response from: ${url}`);
    }

    rows.push(...pageRows);
    totalPages = pageInfo.pages;
    page += 1;
  }

  return rows;
}

async function main() {
  // ---- 1. Get the list of real countries --------------------------------
  // The API's "country" list also includes groups like "World", "Euro area"
  // and "High income". Those all have region = "Aggregates", so we drop them.
  console.log('Fetching country list...');
  const allEntries = await fetchAllPages('country');
  // We also drop the territories listed at the top of this file.
  const realCountries = allEntries.filter(
    (entry) =>
      entry.region.value !== 'Aggregates' &&
      !EXCLUDED_TERRITORIES.has(entry.iso2Code)
  );

  // Build a lookup: 3-letter code (e.g. "FRA") -> our country object.
  // (Indicator rows identify countries by their 3-letter code.)
  const countriesByIso3 = new Map();
  for (const entry of realCountries) {
    countriesByIso3.set(entry.id, {
      // Use our friendlier name if we have one, otherwise the official one.
      name: FRIENDLY_NAMES[entry.iso2Code] ?? entry.name,
      iso2: entry.iso2Code,
      stats: {},
    });
  }

  // ---- 2. Get each stat --------------------------------------------------
  for (const indicator of INDICATORS) {
    console.log(`Fetching ${indicator.key} (${indicator.code})...`);
    const rows = await fetchAllPages(
      `country/all/indicator/${indicator.code}`,
      `&date=${FIRST_YEAR}:${LAST_YEAR}`
    );

    for (const row of rows) {
      // Skip rows with no value, and rows for aggregates like "World".
      if (row.value === null) continue;
      const country = countriesByIso3.get(row.countryiso3code);
      if (!country) continue;

      // Keep this row only if it is newer than what we already have,
      // so we end up with the most recent non-empty year per country.
      const year = Number(row.date);
      const existing = country.stats[indicator.key];
      if (!existing || year > existing.year) {
        country.stats[indicator.key] = { value: row.value, year };
      }
    }
  }

  // ---- 3. Tidy up and save -----------------------------------------------
  // Drop countries that ended up with no stats at all, then sort by name.
  // A country missing just one stat is kept; the game will simply not use
  // it for that category.
  const countries = [...countriesByIso3.values()]
    .filter((country) => Object.keys(country.stats).length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  const output = {
    source: 'World Bank Open Data (https://data.worldbank.org)',
    fetchedOn: new Date().toISOString().slice(0, 10),
    countries,
  };

  const dataFolder = resolve(import.meta.dirname, '..', 'data');
  await mkdir(dataFolder, { recursive: true });
  await writeFile(
    resolve(dataFolder, 'countries.json'),
    JSON.stringify(output, null, 2) + '\n'
  );

  // ---- 4. Print a little report ------------------------------------------
  console.log(`\nSaved ${countries.length} countries to data/countries.json`);
  for (const indicator of INDICATORS) {
    const count = countries.filter((c) => c.stats[indicator.key]).length;
    console.log(`  ${indicator.key.padEnd(15)} ${count} countries`);
  }
}

main().catch((error) => {
  console.error('\nSomething went wrong:', error.message);
  process.exit(1);
});
