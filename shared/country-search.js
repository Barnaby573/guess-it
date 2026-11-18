// shared/country-search.js
//
// Turns what a player types into a country. Any game that asks the player
// to type a country name can use this.
//
// It does three things:
//   1. Suggestions - "ger" offers Germany, "korea" offers both Koreas.
//   2. Exact names and nicknames - "UK", "USA", "Holland".
//   3. Gentle autocorrect - "Lichtenstien" becomes Liechtenstein.
//
// The autocorrect is deliberately cautious. It only fixes small typos in
// longer names, and only when there is exactly one country it could be.

// Other names people commonly use. Keyed by 2-letter ISO code.
const NICKNAMES = {
  GB: ['UK', 'Britain', 'Great Britain', 'England'],
  US: ['USA', 'US', 'America', 'United States of America'],
  CD: ['DRC', 'Democratic Republic of the Congo', 'Congo Kinshasa'],
  CG: ['Congo Brazzaville', 'Congo Republic'],
  NL: ['Holland', 'The Netherlands'],
  AE: ['UAE', 'Emirates'],
  CZ: ['Czech Republic'],
  MM: ['Burma'],
  SZ: ['Swaziland'],
  TL: ['East Timor'],
  CI: ["Cote d'Ivoire"],
  TR: ['Turkiye'],
  MK: ['Macedonia'],
  CV: ['Cabo Verde'],
  BA: ['Bosnia'],
  CF: ['CAR'],
  PG: ['PNG'],
  BS: ['Bahamas'],
  GM: ['Gambia'],
  VA: ['Vatican', 'Holy See'],
  TW: ['Republic of China'],
  SA: ['Saudi'],
};

// Makes text easy to compare: lowercase, no accents, no punctuation.
// "São Tomé and Príncipe" -> "sao tome and principe"
// "Guinea-Bissau"         -> "guinea bissau"
export function normalise(text) {
  return text
    .normalize('NFD') // splits "é" into "e" + an accent mark...
    .replace(/[̀-ͯ]/g, '') // ...then removes the accent marks
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ') // anything that isn't a letter becomes a space
    .replace(/\s+/g, ' ') // squash runs of spaces into one
    .trim();
}

// Counts how many single-letter edits (add, remove or swap a letter) it
// takes to turn one word into another. Called the "Levenshtein distance".
// "lichtenstien" -> "liechtenstein" is 3... a small number means a likely typo.
function editDistance(a, b) {
  // previous[j] = edits needed to turn the first i-1 letters of a
  // into the first j letters of b.
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const swapCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1, // remove a letter
        current[j - 1] + 1, // add a letter
        previous[j - 1] + swapCost // swap a letter (or keep it)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

// How many typos we forgive depends on how long the typed text is.
// Short names get no help at all, because "Iran" and "Iraq" are one
// letter apart and we must never guess between them.
function allowedTypos(length) {
  if (length >= 10) return 3;
  if (length >= 7) return 2;
  if (length >= 5) return 1;
  return 0;
}

// Call this once with the list of countries. It returns two functions:
//   suggest(text) -> a short list of countries to show while typing
//   resolve(text) -> the one country the text means, or null
export function createCountrySearch(countries) {
  // Every name and nickname, in normalised form, pointing at its country.
  const entries = [];
  for (const country of countries) {
    const names = [country.name, ...(NICKNAMES[country.iso2] ?? [])];
    for (const name of names) {
      entries.push({ key: normalise(name), country });
    }
  }

  function suggest(text, limit = 6) {
    const query = normalise(text);
    if (query.length === 0) return [];

    // Best matches first: names that START with the text, then names
    // where a later word starts with it ("korea" finds "South Korea").
    const startsWith = [];
    const wordStartsWith = [];
    for (const { key, country } of entries) {
      if (key.startsWith(query)) startsWith.push(country);
      else if (key.includes(' ' + query)) wordStartsWith.push(country);
    }

    // Alphabetical order within each group, so the list feels predictable.
    const byName = (a, b) => a.name.localeCompare(b.name);
    startsWith.sort(byName);
    wordStartsWith.sort(byName);

    // Remove duplicates (a country can match by name AND nickname).
    const unique = [...new Set([...startsWith, ...wordStartsWith])];
    return unique.slice(0, limit);
  }

  function resolve(text) {
    const query = normalise(text);
    if (query.length === 0) return null;

    // 1. An exact name or nickname always wins.
    const exact = entries.find((entry) => entry.key === query);
    if (exact) return { country: exact.country, corrected: false };

    // 2. Otherwise look for a close typo.
    const limit = allowedTypos(query.length);
    if (limit === 0) return null;

    let bestDistance = Infinity;
    let bestCountries = new Set();
    for (const { key, country } of entries) {
      const distance = editDistance(query, key);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestCountries = new Set([country]);
      } else if (distance === bestDistance) {
        bestCountries.add(country);
      }
    }

    // Only correct it if it's close enough AND there's no doubt which
    // country was meant.
    if (bestDistance <= limit && bestCountries.size === 1) {
      return { country: [...bestCountries][0], corrected: true };
    }
    return null;
  }

  // For games where answers are accepted while you type, without pressing
  // Enter. Returns the country if the text is EXACTLY one of its names, and
  // no other country's name starts with the same text. Otherwise null.
  //
  // That second check matters: "Niger" is a whole country, but it is also
  // the start of "Nigeria", so we wait in case the player keeps typing.
  // Same for "Guinea" (Guinea-Bissau) and "Dominica" (Dominican Republic).
  // The player can press Enter to accept "Niger" straight away.
  function matchWhileTyping(text) {
    const query = normalise(text);
    if (query.length === 0) return null;

    const exact = entries.find((entry) => entry.key === query);
    if (!exact) return null;

    const startOfAnother = entries.some(
      (entry) => entry.country !== exact.country && entry.key.startsWith(query)
    );
    return startOfAnother ? null : exact.country;
  }

  return { suggest, resolve, matchWhileTyping };
}
