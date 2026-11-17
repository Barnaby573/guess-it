// shared/game-helpers.js
//
// Small helper functions used by more than one game: shuffling, showing
// times, and working out distances and directions on the map.

// Returns a copy of a list in random order (the "Fisher-Yates shuffle":
// walk backwards through the list, swapping each item with a random
// earlier one).
export function shuffled(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Turns a number of seconds into "m:ss", e.g. 95 -> "1:35".
export function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

// The distance in kilometres between two places on the globe, each given
// as [longitude, latitude]. This is the "haversine formula", which allows
// for the Earth being round.
export function distanceKm([lon1, lat1], [lon2, lat2]) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const EARTH_RADIUS_KM = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

// Rounds a distance so it reads naturally: "40 km", "850 km", "2,400 km".
export function formatDistance(km) {
  const step = km < 100 ? 10 : km < 1000 ? 50 : 100;
  const rounded = Math.max(step, Math.round(km / step) * step);
  return `${rounded.toLocaleString('en-US')} km`;
}

// Describes the direction from one map point to another in words.
// The compass is split into 8 slices, starting at east and going
// anticlockwise.
export function compassDirection(from, to) {
  const WORDS = [
    'east', 'north-east', 'north', 'north-west',
    'west', 'south-west', 'south', 'south-east',
  ];
  // On screen, y gets bigger going DOWN, so it is flipped to make north "up".
  const angle = Math.atan2(-(to[1] - from[1]), to[0] - from[0]);
  // Each slice is a quarter of pi wide. Rounding picks the nearest one.
  const slice = Math.round(angle / (Math.PI / 4));
  return WORDS[(slice + 8) % 8];
}
