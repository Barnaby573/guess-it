// games/career-path/player-search.js
//
// Turns what the player types into a footballer. Works like the country
// search in shared/country-search.js:
//   suggest("mes")    -> [Lionel Messi, Mesut Özil, ...] to show while typing
//   resolve("messi")  -> Lionel Messi (a surname on its own is fine...)
//   resolve("Silva")  -> null (...unless two players share it)
//   resolve("Ronaldiho") -> Ronaldinho (small typos are forgiven)

import { normalise, editDistance, allowedTypos } from '../../shared/country-search.js';

export function createPlayerSearch(players) {
  // Every full name, plus each surname that only one player has.
  // "Lionel Messi" gives "lionel messi" and "messi".
  const entries = players.map((player) => ({ key: normalise(player.name), player }));

  const surnameCounts = new Map();
  for (const { key } of entries) {
    const surname = key.split(' ').at(-1);
    surnameCounts.set(surname, (surnameCounts.get(surname) ?? 0) + 1);
  }
  for (const { key, player } of [...entries]) {
    const words = key.split(' ');
    const surname = words.at(-1);
    // Only for names with 2+ words, and only if the surname is unique.
    // (Single names like "Ronaldo" already match exactly.)
    if (words.length > 1 && surnameCounts.get(surname) === 1) {
      entries.push({ key: surname, player });
    }
  }

  function suggest(text, limit = 6) {
    const query = normalise(text);
    if (query.length < 2) return [];

    // Names that start with the text first, then names where a later
    // word starts with it ("mbap" finds "Kylian Mbappé").
    const startsWith = [];
    const wordStartsWith = [];
    for (const { key, player } of entries) {
      if (key.startsWith(query)) startsWith.push(player);
      else if (key.includes(' ' + query)) wordStartsWith.push(player);
    }
    const byName = (a, b) => a.name.localeCompare(b.name);
    const unique = [...new Set([...startsWith.sort(byName), ...wordStartsWith.sort(byName)])];
    return unique.slice(0, limit);
  }

  function resolve(text) {
    const query = normalise(text);
    if (query.length === 0) return null;

    // 1. An exact name (or unique surname) always wins.
    const exact = entries.find((entry) => entry.key === query);
    if (exact) return exact.player;

    // 2. Otherwise a close typo, but only if there's no doubt who was meant.
    const limit = allowedTypos(query.length);
    if (limit === 0) return null;

    let bestDistance = Infinity;
    let bestPlayers = new Set();
    for (const { key, player } of entries) {
      const distance = editDistance(query, key);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPlayers = new Set([player]);
      } else if (distance === bestDistance) {
        bestPlayers.add(player);
      }
    }
    if (bestDistance <= limit && bestPlayers.size === 1) return [...bestPlayers][0];
    return null;
  }

  return { suggest, resolve };
}
