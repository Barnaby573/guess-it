// shared/storage.js
//
// Helpers for remembering best streaks between visits.
//
// We use the browser's "localStorage": a small key/value store that lives
// on the player's own device. No server or database is involved.
//
// localStorage can fail (private browsing, storage disabled, storage full),
// so every access is wrapped in try/catch. If it fails, the game still
// works; it just won't remember scores.

// Loads a saved setting (for example a game's chosen options).
// "fallback" is what you get back if nothing was saved or loading fails.
// Settings are stored as JSON text, so they can be objects, not just numbers.
export function loadSetting(key, fallback) {
  try {
    const saved = localStorage.getItem(`guessit:${key}`);
    return saved === null ? fallback : JSON.parse(saved);
  } catch {
    return fallback;
  }
}

// Saves a setting so it is remembered on the next visit.
export function saveSetting(key, value) {
  try {
    localStorage.setItem(`guessit:${key}`, JSON.stringify(value));
  } catch {
    // Couldn't save. The setting still works for this visit.
  }
}

// Builds the name we store a score under,
// e.g. "guessit:higher-lower:best:population".
function makeKey(gameId, category) {
  return `guessit:${gameId}:best:${category}`;
}

// Returns the best streak saved for this game + category (0 if none).
export function getBest(gameId, category) {
  try {
    const saved = localStorage.getItem(makeKey(gameId, category));
    // Stored values are always text, so turn it back into a number.
    return Number(saved) || 0;
  } catch {
    return 0;
  }
}

// Saves the streak if it beats the previous best.
// Returns true if this was a new best, false otherwise.
export function saveBest(gameId, category, streak) {
  if (streak <= getBest(gameId, category)) {
    return false;
  }
  try {
    localStorage.setItem(makeKey(gameId, category), String(streak));
  } catch {
    // Couldn't save. Not a disaster, so we carry on.
  }
  return true;
}
