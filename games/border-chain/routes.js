// games/border-chain/routes.js
//
// The "thinking" part of Border Chain: working out which countries connect,
// how far apart two countries are, and the shortest route between them.
// Nothing in this file touches the page, so it is easy to test on its own.

import borders from '../../data/borders.json';

// borders looks like: { "FR": ["AD", "BE", "DE", ...], "JP": [], ... }

// The countries that can be used in the game: those with a land border.
export const PLAYABLE = Object.keys(borders).filter(
  (code) => borders[code].length > 0
);

// Does country a share a land border with country b?
export function sharesBorder(a, b) {
  return borders[a].includes(b);
}

// Works out the distance from one country to every country it can reach.
//
// This is a "breadth-first search": look at the start's neighbours (1 step
// away), then their neighbours (2 steps), and so on, like ripples spreading
// across a pond. The first time the ripple reaches a country is the
// shortest way to get there.
//
// Returns two lookups:
//   steps[code]    - how many border crossings from the start
//   cameFrom[code] - the country we stepped from to reach it
function explore(start) {
  const steps = { [start]: 0 };
  const cameFrom = {};
  const queue = [start];

  while (queue.length > 0) {
    const current = queue.shift();
    for (const neighbour of borders[current]) {
      if (neighbour in steps) continue; // already reached by a shorter way
      steps[neighbour] = steps[current] + 1;
      cameFrom[neighbour] = current;
      queue.push(neighbour);
    }
  }
  return { steps, cameFrom };
}

// One of the shortest routes from start to end, as a list of codes
// including both ends: ["PT", "ES", "FR", "DE", "PL"].
// Returns null if there is no land route.
export function shortestRoute(start, end) {
  const { steps, cameFrom } = explore(start);
  if (!(end in steps)) return null;

  // Walk backwards from the end using cameFrom, then flip the list.
  const route = [end];
  while (route[route.length - 1] !== start) {
    route.push(cameFrom[route[route.length - 1]]);
  }
  return route.reverse();
}

// Every pair of countries with a land route between them, with how many
// border crossings apart they are. Worked out once when the game loads.
const ALL_PAIRS = [];
for (const start of PLAYABLE) {
  const { steps } = explore(start);
  for (const [end, crossings] of Object.entries(steps)) {
    // Each pair appears twice (A to B and B to A), which is what we want:
    // Portugal -> Poland and Poland -> Portugal are different puzzles.
    if (end !== start) ALL_PAIRS.push({ start, end, crossings });
  }
}

// Picks a random start and end whose shortest route has between
// minCrossings and maxCrossings border crossings.
export function pickPair(minCrossings, maxCrossings) {
  const options = ALL_PAIRS.filter(
    (pair) => pair.crossings >= minCrossings && pair.crossings <= maxCrossings
  );
  return options[Math.floor(Math.random() * options.length)];
}

// FREE ENTRY MODE helper.
// Given the start and the list of countries entered so far, returns the set
// of countries that are linked to the start through an unbroken chain of
// entered countries. (The start itself is always included.)
export function linkedToStart(start, entered) {
  const allowed = new Set(entered);
  const linked = new Set([start]);
  const queue = [start];

  while (queue.length > 0) {
    const current = queue.shift();
    for (const neighbour of borders[current]) {
      if (allowed.has(neighbour) && !linked.has(neighbour)) {
        linked.add(neighbour);
        queue.push(neighbour);
      }
    }
  }
  return linked;
}
