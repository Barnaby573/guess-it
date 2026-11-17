// games/capital-drop/game.js
//
// The Capital Drop game: you are given a capital city and tap the country
// it belongs to, against the clock.
//
// How this file is organised:
//   1. Setup          - imports, settings, and grabbing elements from the page
//   2. Region screen  - the buttons for choosing a region
//   3. Starting       - beginning a round and the timer
//   4. Asking         - showing the next capital
//   5. Answering      - what happens when the player taps the map
//   6. Finishing      - the result pop-up, best scores, share
//   7. Wiring up      - connecting buttons to the functions above
//
// Two helper files do the specialist work:
//   regions.js     - which countries are in which region
//   shared/map.js  - drawing the map, zooming, taps, the arrow and the ring

import data from '../../data/countries.json';
import { renderHeader } from '../../shared/header.js';
import { loadSetting, saveSetting } from '../../shared/storage.js';
import { createMap } from '../../shared/map.js';
import { REGIONS } from './regions.js';

// ===========================================================================
// 1. SETUP
// ===========================================================================

// After this many wrong taps on one capital, the right country is ringed.
const MISSES_BEFORE_RING = 3;
// How long a correct answer stays on screen before the next capital.
const NEXT_DELAY_MS = 900;

// A quick way to look up a country by its 2-letter code.
const COUNTRY = Object.fromEntries(
  data.countries.map((country) => [country.iso2, country])
);
const nameOf = (code) => COUNTRY[code].name;

// Everything that changes during a round lives in this one object.
const state = {
  region: null, // the region being played (one of REGIONS)
  queue: [], // the countries to ask about, in shuffled order
  position: 0, // how far through the queue we are
  target: null, // code of the country the player is looking for
  misses: 0, // wrong taps on the current capital
  wrongHere: [], // countries tapped wrongly for the current capital
  answered: new Set(), // countries already found this round
  missed: [], // countries that took more than one try
  startedAt: 0, // when the round began (milliseconds)
  seconds: 0, // time taken so far
  timer: null, // the ticking timer, so it can be stopped
  locked: false, // true during the pause after a correct answer
  over: true,
};

// The map is a big file, so it loads in the background. "map" stays null
// until it is ready.
let map = null;

const el = {
  regionScreen: document.getElementById('region-screen'),
  regionGrid: document.getElementById('region-grid'),
  gameScreen: document.getElementById('game-screen'),
  backButton: document.getElementById('back-button'),
  time: document.getElementById('time'),
  capitalName: document.getElementById('capital-name'),
  progress: document.getElementById('progress'),
  mapSvg: document.getElementById('map'),
  message: document.getElementById('message'),
  zoomInButton: document.getElementById('zoom-in-button'),
  zoomOutButton: document.getElementById('zoom-out-button'),
  zoomFitButton: document.getElementById('zoom-fit-button'),
  result: document.getElementById('result'),
  resultTitle: document.getElementById('result-title'),
  resultRegion: document.getElementById('result-region'),
  newBest: document.getElementById('new-best'),
  finalScore: document.getElementById('final-score'),
  finalTime: document.getElementById('final-time'),
  missedBox: document.getElementById('missed-box'),
  playAgainButton: document.getElementById('play-again-button'),
  changeRegionButton: document.getElementById('change-region-button'),
  shareButton: document.getElementById('share-button'),
};

// --- Small helpers ---------------------------------------------------------

// Returns a copy of a list in random order (the "Fisher-Yates shuffle":
// walk backwards through the list, swapping each item with a random
// earlier one).
function shuffled(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Turns a number of seconds into "m:ss", e.g. 95 -> "1:35".
function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

// The distance in kilometres between two places on the globe, each given
// as [longitude, latitude]. This is the "haversine formula", which allows
// for the Earth being round.
function distanceKm([lon1, lat1], [lon2, lat2]) {
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
function formatDistance(km) {
  const step = km < 100 ? 10 : km < 1000 ? 50 : 100;
  const rounded = Math.max(step, Math.round(km / step) * step);
  return `${rounded.toLocaleString('en-US')} km`;
}

// Describes the direction from one map point to another in words.
// The compass is split into 8 slices, starting at east and going
// anticlockwise.
function compassDirection(from, to) {
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

// Best scores for every region, loaded from the player's device.
// Looks like: { "western-europe": { score: 20, total: 22, seconds: 105 } }
function loadBests() {
  return loadSetting('capital-drop:best', {});
}

// ===========================================================================
// 2. REGION SCREEN
// ===========================================================================

function showRegionScreen() {
  stopTimer();
  state.over = true;
  el.result.hidden = true;
  el.gameScreen.hidden = true;
  el.regionScreen.hidden = false;

  if (!map) {
    el.regionGrid.innerHTML = '<p class="loading">Loading map...</p>';
    return;
  }

  // Rebuilt each time so the "Best" lines are up to date.
  const bests = loadBests();
  el.regionGrid.innerHTML = '';
  for (const region of REGIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'region-button';
    if (region.key === 'world') button.classList.add('region-world');

    const best = bests[region.key];
    button.innerHTML = `
      <span class="region-emoji">${region.emoji}</span>
      <span class="region-name">${region.label}</span>
      <span class="region-detail">${region.codes.length} capitals</span>
      <span class="region-detail">${
        best
          ? `Best: ${best.score}/${best.total} in ${formatTime(best.seconds)}`
          : 'Not played yet'
      }</span>
    `;
    button.addEventListener('click', () => startRound(region));
    el.regionGrid.append(button);
  }
}

// ===========================================================================
// 3. STARTING A ROUND
// ===========================================================================

function startRound(region) {
  state.region = region;
  state.queue = shuffled(region.codes);
  state.position = 0;
  state.answered = new Set();
  state.missed = [];
  state.wrongHere = [];
  state.locked = false;
  state.over = false;

  // Show the game screen BEFORE moving the map. A hidden map has no size,
  // so the camera couldn't work out how to frame things.
  el.result.hidden = true;
  el.regionScreen.hidden = true;
  el.gameScreen.hidden = false;

  map.reset();
  // Whole world stays zoomed right out. A region zooms to fit its countries.
  if (region.key !== 'world') map.focusOn(region.codes, 900);

  startTimer();
  ask();
}

function startTimer() {
  stopTimer();
  state.startedAt = Date.now();
  state.seconds = 0;
  el.time.textContent = formatTime(0);
  // Check the clock a few times a second. Working the time out from the
  // start time (rather than adding 1 each tick) keeps it accurate even if
  // the browser delays a tick.
  state.timer = setInterval(() => {
    state.seconds = Math.floor((Date.now() - state.startedAt) / 1000);
    el.time.textContent = formatTime(state.seconds);
  }, 250);
}

function stopTimer() {
  clearInterval(state.timer);
  state.timer = null;
}

// ===========================================================================
// 4. ASKING
// ===========================================================================

// Shows the next capital in the queue.
function ask() {
  // Clear the red countries, arrow and ring left from the last capital.
  for (const code of state.wrongHere) map.setState(code, null);
  map.clearMarks();

  state.target = state.queue[state.position];
  state.misses = 0;
  state.wrongHere = [];
  state.locked = false;

  el.capitalName.textContent = COUNTRY[state.target].capital.name;
  setMessage('Tap the country on the map.');
  renderProgress();
}

// The line under the capital: "7 of 22 · 5 right · 1 missed"
function renderProgress() {
  const total = state.queue.length;
  const missed = state.missed.length;
  // "Right" means found on the first try.
  const right = state.answered.size - state.missed.filter((code) => state.answered.has(code)).length;
  const number = Math.min(state.position + 1, total);
  el.progress.textContent = `${number} of ${total} · ${right} right · ${missed} missed`;
}

// Shows a line of feedback under the map.
// tone is 'good' (green), 'bad' (red) or left out (neutral).
function setMessage(text, tone = 'info') {
  el.message.textContent = text;
  el.message.dataset.tone = tone;
}

// ===========================================================================
// 5. ANSWERING
// ===========================================================================

// Called by the map when the player taps it. code is the country tapped
// (or null for sea), and point is where on the map they tapped.
function handlePick({ code, point }) {
  if (state.over || state.locked) return;

  const capital = COUNTRY[state.target].capital;

  // Tapped the sea, or land that isn't one of the 195 (like Greenland).
  // No penalty: it's too easy to do by accident near small islands.
  if (!code) {
    setMessage("That isn't one of the countries. Try again.");
    return;
  }

  // ---- Correct ----
  if (code === state.target) {
    const firstTry = state.misses === 0;
    state.answered.add(code);
    map.clearMarks();
    for (const wrong of state.wrongHere) map.setState(wrong, null);
    state.wrongHere = [];
    // Green if found first time. A paler red if it took more than one go,
    // because that capital already counts as missed.
    map.setState(code, firstTry ? 'right' : 'missed');
    setMessage(`${capital.name} is the capital of ${nameOf(code)}.`, firstTry ? 'good' : 'info');

    // Pause so the player can see the answer, then move on.
    state.locked = true;
    state.position += 1;
    renderProgress();
    setTimeout(() => {
      if (state.over) return; // the player left during the pause
      if (state.position >= state.queue.length) finish();
      else ask();
    }, NEXT_DELAY_MS);
    return;
  }

  // Tapped a country that's already been found this round. No penalty.
  if (state.answered.has(code)) {
    setMessage(`You've already found ${nameOf(code)}.`);
    return;
  }

  // ---- Wrong ----
  // Tapping a country you've already tried for this capital just shows the
  // arrow again. Only a NEW wrong country counts towards the ring.
  if (!state.wrongHere.includes(code)) {
    state.misses += 1;
    state.wrongHere.push(code);
  }
  // The first wrong tap is what makes this capital count as missed.
  // Later wrong taps on the same capital don't count again.
  if (state.misses === 1 && !state.missed.includes(state.target)) {
    state.missed.push(state.target);
  }
  map.setState(code, 'wrong');

  // Point the way: an arrow on the map, plus distance and direction in words.
  const capitalPoint = map.project(capital.lon, capital.lat);
  map.showArrow(point, capitalPoint);
  const distance = formatDistance(
    distanceKm(map.unproject(point[0], point[1]), [capital.lon, capital.lat])
  );
  const direction = compassDirection(point, capitalPoint);
  setMessage(
    `Not ${nameOf(code)}. ${capital.name} is about ${distance} to the ${direction}.`,
    'bad'
  );

  // After enough misses, ring the right country. The player still has to
  // tap it to move on.
  if (state.misses >= MISSES_BEFORE_RING) {
    map.showRing(state.target);
    // Make sure the ring can be seen, without undoing a view that
    // already shows it.
    if (!map.isOnScreen(state.target)) {
      map.focusOn([state.target, ...state.wrongHere]);
    }
  }

  renderProgress();
}

// ===========================================================================
// 6. FINISHING
// ===========================================================================

function finish() {
  state.over = true;
  stopTimer();

  const total = state.queue.length;
  const score = total - state.missed.length;

  // Is this the best result for this region? A higher score wins; if the
  // score is the same, the faster time wins.
  const bests = loadBests();
  const old = bests[state.region.key];
  const isBest =
    !old ||
    score > old.score ||
    (score === old.score && state.seconds < old.seconds);
  if (isBest) {
    bests[state.region.key] = { score, total, seconds: state.seconds };
    saveSetting('capital-drop:best', bests);
  }

  el.resultTitle.textContent = score === total ? 'Perfect score!' : 'Round complete';
  el.resultRegion.textContent = state.region.label;
  // Only celebrate a new best if there was an old one to beat.
  el.newBest.hidden = !(isBest && old);
  el.finalScore.textContent = `${score}/${total}`;
  el.finalTime.textContent = formatTime(state.seconds);

  // List the capitals that were missed, so the player can learn them.
  el.missedBox.innerHTML = '';
  el.missedBox.hidden = state.missed.length === 0;
  if (state.missed.length > 0) {
    const label = document.createElement('p');
    label.className = 'missed-label';
    label.textContent = 'Ones to learn';
    el.missedBox.append(label);

    for (const code of state.missed) {
      const row = document.createElement('div');
      row.className = 'missed-row';
      const capital = document.createElement('span');
      capital.textContent = COUNTRY[code].capital.name;
      const country = document.createElement('strong');
      country.textContent = nameOf(code);
      row.append(capital, country);
      el.missedBox.append(row);
    }
  }

  el.shareButton.textContent = 'Share';
  el.result.hidden = false;
  el.playAgainButton.focus();
}

// Copies a brag message to the clipboard, e.g.
// "Guess It 📍 Capital Drop: Western Europe 20/22 in 1:45"
async function share() {
  const total = state.queue.length;
  const score = total - state.missed.length;
  const text = `Guess It 📍 Capital Drop: ${state.region.label} ${score}/${total} in ${formatTime(state.seconds)}`;

  try {
    await navigator.clipboard.writeText(text);
    el.shareButton.textContent = 'Copied!';
  } catch {
    // Some browsers block clipboard access. Show the text in a pop-up
    // so the player can copy it by hand instead.
    window.prompt('Copy your result:', text);
  }
}

// ===========================================================================
// 7. WIRING UP
// ===========================================================================

el.backButton.addEventListener('click', showRegionScreen);
el.playAgainButton.addEventListener('click', () => startRound(state.region));
el.changeRegionButton.addEventListener('click', showRegionScreen);
el.shareButton.addEventListener('click', share);

// The zoom buttons in the corner of the map.
el.zoomInButton.addEventListener('click', () => map.zoomBy(0.6));
el.zoomOutButton.addEventListener('click', () => map.zoomBy(1 / 0.6));
el.zoomFitButton.addEventListener('click', () => map.focusOn(state.region.codes));

// Load the map in the background, then show the region buttons.
async function loadMap() {
  try {
    // import() fetches a file only when asked, so the big map file
    // doesn't slow down the first paint of the page.
    const mapData = (await import('../../data/map.json')).default;
    // onPick tells the map which function to call when the player taps it.
    map = createMap(el.mapSvg, mapData, { onPick: handlePick });
    showRegionScreen();
  } catch {
    el.regionGrid.innerHTML =
      '<p class="loading">The map failed to load. Refresh the page to try again.</p>';
  }
}

// Go! Add the header, show the region screen and start loading the map.
renderHeader('../../');
showRegionScreen();
loadMap();
