// games/learn-countries/game.js
//
// The Learn Countries game. Two modes:
//
//   FIND ON MAP  - you are given a country and tap it on the map, against
//                  the clock. Exactly like Capital Drop, but with country
//                  names instead of capitals.
//   TYPE THEM IN - type as many countries in the region as you can think
//                  of. Each one you get fills in on the map.
//
// How this file is organised:
//   1. Setup          - imports, settings, and grabbing elements from the page
//   2. Region screen  - the mode picker and region buttons
//   3. Starting       - beginning a round, and the timer
//   4. Find mode      - asking for a country and checking taps
//   5. Type mode      - checking typed countries
//   6. Finishing      - the result pop-up, best scores, share
//   7. Wiring up      - connecting buttons to the functions above
//
// Helper files that do the specialist work:
//   shared/regions.js        - which countries are in which region
//   shared/map.js            - drawing the map, zooming, taps, the arrow and the ring
//   shared/country-search.js - turning typed text into a country (with autocorrect)
//   shared/game-helpers.js   - shuffling, times, distances and directions

import data from '../../data/countries.json';
import { renderHeader } from '../../shared/header.js';
import { loadSetting, saveSetting } from '../../shared/storage.js';
import { createMap } from '../../shared/map.js';
import { createCountrySearch } from '../../shared/country-search.js';
import { REGIONS } from '../../shared/regions.js';
import {
  shuffled,
  formatTime,
  distanceKm,
  formatDistance,
  compassDirection,
} from '../../shared/game-helpers.js';

// ===========================================================================
// 1. SETUP
// ===========================================================================

// The two modes. To add a mode, add it here and give it its own section
// below; a button for it appears automatically.
const MODES = {
  find: {
    label: 'Find on map',
    help: 'You get a country. Tap it on the map. Wrong taps count as missed.',
  },
  type: {
    label: 'Type them in',
    help: 'Type every country you can think of. Watch the map fill up.',
  },
};

// FIND MODE: after this many different wrong countries, the right one is
// ringed on the map.
const MISSES_BEFORE_RING = 3;
// FIND MODE: how long a correct answer stays on screen before the next one.
const NEXT_DELAY_MS = 900;

// A quick way to look up a country by its 2-letter code.
const COUNTRY = Object.fromEntries(
  data.countries.map((country) => [country.iso2, country])
);
const nameOf = (code) => COUNTRY[code].name;

const search = createCountrySearch(data.countries);

// The chosen mode, remembered between visits.
let mode = loadSetting('learn-countries:mode', 'find');
if (!MODES[mode]) mode = 'find';

// Everything that changes during a round lives in this one object.
const state = {
  region: null, // the region being played (one of REGIONS)
  codes: [], // the countries in that region
  startedAt: 0, // when the round began (milliseconds)
  seconds: 0, // time taken so far
  timer: null, // the ticking timer, so it can be stopped
  over: true,

  // FIND MODE
  queue: [], // the countries to ask about, in shuffled order
  position: 0, // how far through the queue we are
  target: null, // code of the country the player is looking for
  misses: 0, // different wrong countries tapped for the current one
  wrongHere: [], // those wrong countries, so they can be cleared
  missed: [], // countries that took more than one try
  locked: false, // true during the pause after a correct answer

  // TYPE MODE
  found: new Set(), // countries typed correctly so far
};

// The map and its data load in the background. Both stay null until ready.
let map = null;
let mapData = null;

const el = {
  regionScreen: document.getElementById('region-screen'),
  modePicker: document.getElementById('mode-picker'),
  modeHelp: document.getElementById('mode-help'),
  regionGrid: document.getElementById('region-grid'),
  gameScreen: document.getElementById('game-screen'),
  backButton: document.getElementById('back-button'),
  time: document.getElementById('time'),
  count: document.getElementById('count'),
  findPrompt: document.getElementById('find-prompt'),
  countryName: document.getElementById('country-name'),
  progress: document.getElementById('progress'),
  typeForm: document.getElementById('type-form'),
  typeInput: document.getElementById('type-input'),
  mapSvg: document.getElementById('map'),
  message: document.getElementById('message'),
  giveUpButton: document.getElementById('give-up-button'),
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
  lookButton: document.getElementById('look-button'),
  changeRegionButton: document.getElementById('change-region-button'),
  shareButton: document.getElementById('share-button'),
};

// Best results, saved on the player's device. One per mode and region:
// { "type:western-europe": { score: 20, total: 22, seconds: 185 }, ... }
function loadBests() {
  return loadSetting('learn-countries:best', {});
}
const bestKey = (regionKey) => `${mode}:${regionKey}`;

// Shows a line of feedback under the map.
// tone is 'good' (green), 'bad' (red) or left out (neutral).
function setMessage(text, tone = 'info') {
  el.message.textContent = text;
  el.message.dataset.tone = tone;
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

  // The mode buttons. The chosen one is highlighted.
  el.modePicker.innerHTML = '';
  for (const [key, info] of Object.entries(MODES)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'picker-button'; // styled in shared/game-ui.css
    button.textContent = info.label;
    button.setAttribute('aria-pressed', key === mode);
    button.addEventListener('click', () => {
      mode = key;
      saveSetting('learn-countries:mode', mode);
      showRegionScreen(); // redraw so the highlight and bests update
    });
    el.modePicker.append(button);
  }
  el.modeHelp.textContent = MODES[mode].help;

  if (!map) {
    el.regionGrid.innerHTML = '<p class="loading">Loading map...</p>';
    return;
  }

  // The region buttons, showing the best result for the chosen mode.
  const bests = loadBests();
  el.regionGrid.innerHTML = '';
  for (const region of REGIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'region-button';
    if (region.key === 'world') button.classList.add('region-world');

    const best = bests[bestKey(region.key)];
    button.innerHTML = `
      <span class="region-emoji">${region.emoji}</span>
      <span class="region-name">${region.label}</span>
      <span class="region-detail">${region.codes.length} countries</span>
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
  state.codes = region.codes;
  state.over = false;

  // Show the parts of the screen this mode uses, hide the rest.
  const isFind = mode === 'find';
  el.findPrompt.hidden = !isFind;
  el.typeForm.hidden = isFind;
  el.giveUpButton.hidden = isFind;

  // Show the game screen BEFORE moving the map. A hidden map has no size,
  // so the camera couldn't work out how to frame things.
  el.result.hidden = true;
  el.regionScreen.hidden = true;
  el.gameScreen.hidden = false;

  map.reset();
  // Grey out every country outside this region: they can't be the answer.
  map.setPlayable(region.codes);
  // Whole world stays zoomed right out. A region zooms to fit its countries.
  if (region.key !== 'world') map.focusOn(region.codes, 900);

  startTimer();
  if (isFind) startFind();
  else startType();
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

// The "✓ 5/22" pill in the top bar.
function renderCount(done) {
  el.count.textContent = `${done}/${state.codes.length}`;
}

// ===========================================================================
// 4. FIND MODE
// ===========================================================================

function startFind() {
  map.setHoverEnabled(true);
  state.queue = shuffled(state.codes);
  state.position = 0;
  state.missed = [];
  state.wrongHere = [];
  askNext();
}

// Shows the next country in the queue.
function askNext() {
  // Clear the red countries, arrow and ring left from the last one.
  for (const code of state.wrongHere) map.setState(code, null);
  map.clearMarks();

  state.target = state.queue[state.position];
  state.misses = 0;
  state.wrongHere = [];
  state.locked = false;

  el.countryName.textContent = nameOf(state.target);
  setMessage('Tap it on the map.');
  renderFindProgress();
}

// The line under the country: "7 of 22 · 5 right · 1 missed"
function renderFindProgress() {
  const total = state.queue.length;
  const done = state.position;
  const right = done - state.missed.filter((code) => state.queue.indexOf(code) < done).length;
  const number = Math.min(done + 1, total);
  el.progress.textContent = `${number} of ${total} · ${right} right · ${state.missed.length} missed`;
  renderCount(done);
}

// The middle of a country's main piece of land, as a map point.
function centreOf(code) {
  const [x, y, width, height] = mapData.countries[code].box;
  return [x + width / 2, y + height / 2];
}

// Called by the map when the player taps it. code is the country tapped
// (or null for sea), and point is where on the map they tapped.
function handlePick({ code, point }) {
  // Taps only count in find mode, during a round.
  if (mode !== 'find' || state.over || state.locked) return;

  const targetName = nameOf(state.target);

  // Tapped the sea, or land that isn't one of the 195 (like Greenland).
  // No penalty: it's too easy to do by accident near small islands.
  if (!code) {
    setMessage("That isn't one of the countries. Try again.");
    return;
  }

  // Tapped a greyed-out country. No penalty: just say so.
  if (!state.region.codes.includes(code)) {
    setMessage(`${nameOf(code)} isn't in this round.`);
    return;
  }

  // ---- Correct ----
  if (code === state.target) {
    const firstTry = state.misses === 0;
    map.clearMarks();
    for (const wrong of state.wrongHere) map.setState(wrong, null);
    state.wrongHere = [];
    // Green if found first time. A paler red if it took more than one go,
    // because it already counts as missed.
    map.setState(code, firstTry ? 'right' : 'missed');
    setMessage(`That's ${targetName}.`, firstTry ? 'good' : 'info');

    // Pause so the player can see the answer, then move on.
    state.locked = true;
    state.position += 1;
    renderFindProgress();
    setTimeout(() => {
      if (state.over) return; // the player left during the pause
      if (state.position >= state.queue.length) finish();
      else askNext();
    }, NEXT_DELAY_MS);
    return;
  }

  // Tapped a country that's already been found this round. No penalty.
  const alreadyDone = state.queue.slice(0, state.position).includes(code);
  if (alreadyDone) {
    setMessage(`You've already found ${nameOf(code)}.`);
    return;
  }

  // ---- Wrong ----
  // Tapping a country you've already tried for this one just shows the
  // arrow again. Only a NEW wrong country counts towards the ring.
  if (!state.wrongHere.includes(code)) {
    state.misses += 1;
    state.wrongHere.push(code);
  }
  // The first wrong tap is what makes this country count as missed.
  if (state.misses === 1 && !state.missed.includes(state.target)) {
    state.missed.push(state.target);
  }
  map.setState(code, 'wrong');

  // Point the way: an arrow on the map, plus distance and direction in words.
  // The country, measured the short way round the globe from the tap
  // (the map wraps round, so across the Pacific can be shorter).
  const targetPoint = map.nearestCopy(centreOf(state.target), point);
  map.showArrow(point, targetPoint);
  const distance = formatDistance(
    distanceKm(map.unproject(...point), map.unproject(...targetPoint))
  );
  const direction = compassDirection(point, targetPoint);
  setMessage(
    `That's ${nameOf(code)}. ${targetName} is about ${distance} to the ${direction}.`,
    'bad'
  );

  // After enough misses, ring the right country. The player still has to
  // tap it to move on.
  if (state.misses >= MISSES_BEFORE_RING) {
    map.showRing(state.target);
    if (!map.isOnScreen(state.target)) {
      map.focusOn([state.target, ...state.wrongHere]);
    }
  }

  renderFindProgress();
}

// ===========================================================================
// 5. TYPE MODE
// ===========================================================================

function startType() {
  map.setHoverEnabled(false); // you answer by typing, so taps do nothing
  state.found = new Set();
  el.typeInput.value = '';
  renderCount(0);
  setMessage(`Name the ${state.codes.length} countries in ${state.region.label}.`);
  el.typeInput.focus();
}

// Called with the country the player typed. Returns true if the text box
// should be cleared (the answer has been dealt with).
function acceptTyped(country) {
  const code = country.iso2;

  if (!state.codes.includes(code)) {
    setMessage(`${country.name} isn't in ${state.region.label}.`);
    return true;
  }
  if (state.found.has(code)) {
    setMessage(`You've already got ${country.name}.`);
    return true;
  }

  state.found.add(code);
  map.setState(code, 'right');
  setMessage(`✓ ${country.name}`, 'good');
  renderCount(state.found.size);

  // A quick green flash on the text box. Removing the class and forcing
  // the browser to notice ("reflow") lets the animation play again.
  el.typeInput.classList.remove('is-correct');
  void el.typeInput.offsetWidth;
  el.typeInput.classList.add('is-correct');

  if (state.found.size === state.codes.length) finish();
  return true;
}

// As the player types: accept the country the moment the text is a
// complete name (unless it could still be the start of a longer name,
// like "Niger" -> "Nigeria"; then they press Enter).
function onTyping() {
  if (state.over) return;
  const country = search.matchWhileTyping(el.typeInput.value);
  if (country && acceptTyped(country)) el.typeInput.value = '';
}

// When the player presses Enter: accept the text, with gentle autocorrect
// for typos ("Lichtenstien" -> Liechtenstein).
function onEnter(event) {
  event.preventDefault(); // stop the browser reloading the page
  if (state.over) return;
  const typed = el.typeInput.value.trim();
  if (typed === '') return;

  const match = search.resolve(typed);
  if (!match) {
    setMessage(`"${typed}" isn't a country I recognise.`, 'bad');
    return;
  }
  if (acceptTyped(match.country)) el.typeInput.value = '';
}

// ===========================================================================
// 6. FINISHING
// ===========================================================================

// The score for this round: how many countries were got right.
function currentScore() {
  return mode === 'find'
    ? state.queue.length - state.missed.length
    : state.found.size;
}

// The countries to list under "Ones to learn".
function countriesToLearn() {
  return mode === 'find'
    ? state.missed
    : state.codes.filter((code) => !state.found.has(code));
}

function finish() {
  state.over = true;
  stopTimer();
  map.clearMarks();

  const total = state.codes.length;
  const score = currentScore();
  const toLearn = countriesToLearn();

  // TYPE MODE: colour in the ones that were missed, so the map shows them.
  if (mode === 'type') {
    for (const code of toLearn) map.setState(code, 'wrong');
  }

  // Is this the best result for this mode and region? A higher score wins;
  // if the score is the same, the faster time wins.
  const bests = loadBests();
  const key = bestKey(state.region.key);
  const old = bests[key];
  const isBest =
    !old || score > old.score || (score === old.score && state.seconds < old.seconds);
  if (isBest) {
    bests[key] = { score, total, seconds: state.seconds };
    saveSetting('learn-countries:best', bests);
  }

  if (score === total) el.resultTitle.textContent = 'Perfect score!';
  else if (mode === 'type') el.resultTitle.textContent = 'Here’s how you did';
  else el.resultTitle.textContent = 'Round complete';
  el.resultRegion.textContent = `${state.region.label} · ${MODES[mode].label}`;
  // Only celebrate a new best if there was an old one to beat.
  el.newBest.hidden = !(isBest && old);
  el.finalScore.textContent = `${score}/${total}`;
  el.finalTime.textContent = formatTime(state.seconds);

  // List the countries to learn, alphabetically.
  el.missedBox.innerHTML = '';
  el.missedBox.hidden = toLearn.length === 0;
  if (toLearn.length > 0) {
    const label = document.createElement('p');
    label.className = 'missed-label';
    label.textContent = mode === 'find' ? 'Ones to learn' : 'Ones you missed';
    el.missedBox.append(label);
    for (const code of [...toLearn].sort((a, b) => nameOf(a).localeCompare(nameOf(b)))) {
      const row = document.createElement('div');
      row.className = 'missed-row';
      row.textContent = nameOf(code);
      el.missedBox.append(row);
    }
  }

  el.shareButton.textContent = 'Share';
  el.result.hidden = false;
  el.playAgainButton.focus();
}

// Closes the pop-up so the finished map can be studied. The back button
// in the top bar returns to the regions.
function lookAtMap() {
  el.result.hidden = true;
  map.focusOn(state.codes);
  setMessage('Press ← Regions when you’re done.');
}

// Copies a brag message to the clipboard, e.g.
// "Guess It 🗺️ Learn Countries (Type them in): Western Europe 20/22 in 3:05"
async function share() {
  const text = `Guess It 🗺️ Learn Countries (${MODES[mode].label}): ${state.region.label} ${currentScore()}/${state.codes.length} in ${formatTime(state.seconds)}`;
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
el.lookButton.addEventListener('click', lookAtMap);
el.changeRegionButton.addEventListener('click', showRegionScreen);
el.shareButton.addEventListener('click', share);
el.giveUpButton.addEventListener('click', () => {
  if (!state.over) finish();
});

el.typeForm.addEventListener('submit', onEnter);
el.typeInput.addEventListener('input', onTyping);

// The zoom buttons in the corner of the map.
el.zoomInButton.addEventListener('click', () => map.zoomBy(0.6));
el.zoomOutButton.addEventListener('click', () => map.zoomBy(1 / 0.6));
el.zoomFitButton.addEventListener('click', () => map.focusOn(state.codes));

// Load the map in the background, then show the region buttons.
async function loadMap() {
  try {
    // import() fetches a file only when asked, so the big map file
    // doesn't slow down the first paint of the page.
    mapData = (await import('../../data/map.json')).default;
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
