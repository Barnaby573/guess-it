// games/higher-lower/game.js
//
// All the logic for the Higher or Lower game.
//
// How this file is organised:
//   1. Setup        - imports, settings, and grabbing elements from the page
//   2. Start screen - the category buttons
//   3. Picking      - choosing countries and categories for each round
//   4. Drawing      - putting a country onto a card
//   5. Guessing     - what happens when the player presses Higher / Lower
//   6. Game over    - the final screen, play again, share
//   7. Wiring up    - connecting buttons and keys to the functions above

import data from '../../data/countries.json';
import { renderHeader } from '../../shared/header.js';
import { getBest, saveBest } from '../../shared/storage.js';
import { CATEGORIES, formatValue } from './categories.js';

// ===========================================================================
// 1. SETUP
// ===========================================================================

const GAME_ID = 'higher-lower'; // used in the localStorage key
const MIXED = 'mixed'; // the special "random category each round" mode

// Timings, in milliseconds (1000 = one second)
const COUNT_UP_MS = 1000; // how long the number takes to count up
const RESULT_PAUSE_MS = 900; // how long green/red shows before moving on
const SLIDE_MS = 450; // must match the transition time in game.css

// DIFFICULTY RAMP
//
// For each category we sort the countries from smallest to biggest value.
// The "gap" between two countries is how far apart they are in that sorted
// list, as a fraction of the whole list (0.5 = half the list apart).
//
// A big gap means very different values (easy). A small gap means close
// values (hard). Every 5 points the player moves down one row of their
// difficulty's table, and stays on the last row after that.
//
// (We compare positions in the list rather than dividing one value by the
// other, because the same rule then works for every category. Populations
// can differ by 100,000 times, but life expectancies only by about 1.5.)
//
// With about 195 countries, a gap of 0.01 is roughly 2 places apart in the
// list, and a minGap of 0 allows next-door neighbours.
//
// To tune the game, change the numbers below. To add a new difficulty,
// add another block; a button for it appears automatically.
const DIFFICULTIES = {
  easy: {
    label: 'Easy',
    levels: [
      { minGap: 0.3, maxGap: 1.0 }, //  streak 0-4:   very different
      { minGap: 0.18, maxGap: 0.6 }, // streak 5-9
      { minGap: 0.1, maxGap: 0.35 }, // streak 10-14
      { minGap: 0.05, maxGap: 0.2 }, // streak 15-19
      { minGap: 0.01, maxGap: 0.12 }, // streak 20+
    ],
  },
  medium: {
    label: 'Medium',
    levels: [
      { minGap: 0.1, maxGap: 0.35 }, //  streak 0-4
      { minGap: 0.05, maxGap: 0.2 }, //  streak 5-9
      { minGap: 0.02, maxGap: 0.12 }, // streak 10-14
      { minGap: 0.01, maxGap: 0.07 }, // streak 15+
    ],
  },
  hard: {
    label: 'Hard',
    levels: [
      { minGap: 0.02, maxGap: 0.12 }, // streak 0-4:  already close
      { minGap: 0.01, maxGap: 0.07 }, // streak 5-9
      { minGap: 0, maxGap: 0.04 }, //    streak 10+:  near neighbours
    ],
  },
};
const DEFAULT_DIFFICULTY = 'medium';
const POINTS_PER_LEVEL = 5;

// For each category, a list of the countries that have that stat, sorted
// from smallest value to biggest. Built once when the page loads.
const SORTED = {};
for (const key of Object.keys(CATEGORIES)) {
  SORTED[key] = data.countries
    .filter((country) => country.stats[key])
    .sort((a, b) => a.stats[key].value - b.stats[key].value);
}

// Everything that changes while playing lives in this one object.
const state = {
  mode: null, // what the player picked: a category key, or MIXED
  difficulty: loadDifficulty(), // 'easy', 'medium' or 'hard'
  category: null, // the category for the current round
  streak: 0,
  used: new Set(), // ISO codes of countries already seen this run
  left: null, // the country on the left card
  right: null, // the country on the right card
  busy: false, // true while animations run, so extra clicks are ignored
  over: false, // true while the game over screen is showing
};

// Grab the page elements we need, once, so we don't keep searching for them.
const el = {
  startScreen: document.getElementById('start-screen'),
  difficultyPicker: document.getElementById('difficulty-picker'),
  categoryGrid: document.getElementById('category-grid'),
  modeLabel: document.getElementById('mode-label'),
  gameScreen: document.getElementById('game-screen'),
  question: document.getElementById('question'),
  streak: document.getElementById('streak'),
  best: document.getElementById('best'),
  board: document.getElementById('board'),
  leftCard: document.getElementById('card-left'),
  rightCard: document.getElementById('card-right'),
  guessButtons: document.getElementById('guess-buttons'),
  higherButton: document.getElementById('higher-button'),
  lowerButton: document.getElementById('lower-button'),
  backButton: document.getElementById('back-button'),
  gameover: document.getElementById('gameover'),
  newBest: document.getElementById('new-best'),
  finalStreak: document.getElementById('final-streak'),
  finalBest: document.getElementById('final-best'),
  answerBox: document.getElementById('answer-box'),
  playAgainButton: document.getElementById('play-again-button'),
  changeCategoryButton: document.getElementById('change-category-button'),
  shareButton: document.getElementById('share-button'),
};

// Does this person's device ask for reduced motion? If so we skip animations.
const reducedMotion = window.matchMedia(
  '(prefers-reduced-motion: reduce)'
).matches;

// --- Small helpers ---------------------------------------------------------

// Pick a random item from a list.
function randomItem(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// Pause for a number of milliseconds. Used like:  await wait(500);
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The name to show for a mode: "Population", "GDP", ... or "Mixed".
function modeLabel(mode) {
  return mode === MIXED ? 'Mixed' : CATEGORIES[mode].label;
}

// Best streaks are saved separately for each category AND difficulty, so an
// Easy streak never competes with a Hard one. This builds the name the
// score is saved under, e.g. "population-hard".
function bestKey(mode) {
  return `${mode}-${state.difficulty}`;
}

// Remembers the chosen difficulty between visits. Like the scores, this
// uses localStorage, so it is wrapped in try/catch in case that fails.
function loadDifficulty() {
  try {
    const saved = localStorage.getItem('guessit:higher-lower:difficulty');
    // Only trust the saved value if it's a difficulty that still exists.
    if (saved && DIFFICULTIES[saved]) return saved;
  } catch {
    // Ignore: fall through to the default.
  }
  return DEFAULT_DIFFICULTY;
}

function saveDifficulty(difficulty) {
  try {
    localStorage.setItem('guessit:higher-lower:difficulty', difficulty);
  } catch {
    // Couldn't save. The choice still works for this visit.
  }
}

// The web address of a country's flag image.
function flagUrl(country) {
  return `https://flagcdn.com/w320/${country.iso2.toLowerCase()}.png`;
}

// ===========================================================================
// 2. START SCREEN
// ===========================================================================

// Builds one category button, e.g.  [ 👥 Population  Best: 7 ]
function makeCategoryButton(mode, emoji) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'category-button';
  if (mode === MIXED) button.classList.add('category-mixed');

  const best = getBest(GAME_ID, bestKey(mode));
  button.innerHTML = `
    <span class="category-emoji">${emoji}</span>
    <span class="category-name">${modeLabel(mode)}</span>
    <span class="category-best">${best > 0 ? `Best: ${best}` : 'Not played yet'}</span>
  `;

  button.addEventListener('click', () => startGame(mode));
  return button;
}

// Shows the start screen. The buttons are rebuilt every time so the
// "Best" numbers on them are always up to date.
function showStartScreen() {
  state.over = false;
  el.gameover.hidden = true;
  el.gameScreen.hidden = true;
  el.startScreen.hidden = false;

  // The Easy / Medium / Hard buttons. The chosen one is highlighted.
  el.difficultyPicker.innerHTML = '';
  for (const [key, difficulty] of Object.entries(DIFFICULTIES)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'difficulty-button';
    button.textContent = difficulty.label;
    // aria-pressed tells screen readers which one is selected,
    // and game.css uses it to highlight the button.
    button.setAttribute('aria-pressed', key === state.difficulty);
    button.addEventListener('click', () => {
      state.difficulty = key;
      saveDifficulty(key);
      // Redraw so the highlight and the "Best" numbers update.
      showStartScreen();
    });
    el.difficultyPicker.append(button);
  }

  el.categoryGrid.innerHTML = '';
  for (const [key, category] of Object.entries(CATEGORIES)) {
    el.categoryGrid.append(makeCategoryButton(key, category.emoji));
  }
  el.categoryGrid.append(makeCategoryButton(MIXED, '🎲'));
}

// ===========================================================================
// 3. PICKING COUNTRIES AND CATEGORIES
// ===========================================================================

// Decides the category for the next round.
// Normal modes always use the chosen category. Mixed mode picks a random
// one, but only from stats the left-hand country actually has.
function pickCategory(leftCountry) {
  if (state.mode !== MIXED) return state.mode;

  const options = Object.keys(CATEGORIES).filter(
    (key) => !leftCountry || leftCountry.stats[key]
  );
  return randomItem(options);
}

// Picks a new right-hand country to compare against the left-hand one.
function pickOpponent(leftCountry, category) {
  const list = SORTED[category];
  const leftPosition = list.indexOf(leftCountry);

  // Which row of the chosen difficulty's table are we on?
  const levels = DIFFICULTIES[state.difficulty].levels;
  const level = Math.min(
    Math.floor(state.streak / POINTS_PER_LEVEL),
    levels.length - 1
  );
  const { minGap, maxGap } = levels[level];

  // Countries we haven't shown yet this run.
  let unused = list.filter((country) => !state.used.has(country.iso2));

  // If the player has somehow seen every country (a streak of nearly 200!),
  // forget the history so the game can carry on.
  if (unused.length === 0) {
    state.used = new Set([leftCountry.iso2]);
    unused = list.filter((country) => country !== leftCountry);
  }

  // Keep only the ones whose gap from the left country suits this level.
  const suitable = unused.filter((country) => {
    const gap = Math.abs(list.indexOf(country) - leftPosition) / list.length;
    return gap >= minGap && gap <= maxGap;
  });

  // If nothing fits (rare, late in a long run), any unused country will do.
  return randomItem(suitable.length > 0 ? suitable : unused);
}

// ===========================================================================
// 4. DRAWING A CARD
// ===========================================================================

// Puts a country onto a card.
// showValue = true for the left card (number visible),
//             false for the right card (number hidden, buttons shown).
function renderCard(cardElement, country, showValue) {
  const stat = country.stats[state.category];

  const flag = cardElement.querySelector('.flag');
  flag.style.visibility = 'visible';
  flag.src = flagUrl(country);
  flag.alt = `Flag of ${country.name}`;

  cardElement.querySelector('.country-name').textContent = country.name;

  const value = cardElement.querySelector('.value');
  const year = cardElement.querySelector('.year');
  value.textContent = formatValue(state.category, stat.value);
  year.textContent = `World Bank, ${stat.year}`;
  value.hidden = !showValue;
  year.hidden = !showValue;

  // Clear any green/red left over from the previous round.
  cardElement.classList.remove('correct', 'wrong');
}

// Draws both cards and the text around them for the current round.
function renderRound() {
  renderCard(el.leftCard, state.left, true);
  renderCard(el.rightCard, state.right, false);
  el.guessButtons.hidden = false;

  const label = CATEGORIES[state.category].label;
  el.question.innerHTML = `<strong>${label}</strong>: is ${state.right.name} higher or lower than ${state.left.name}?`;
  el.streak.textContent = state.streak;
}

// Sets up the next round: chooses the category and the new right-hand country.
function setUpRound() {
  state.category = pickCategory(state.left);

  // First round only: there is no left-hand country yet, so pick one.
  if (!state.left) {
    state.left = randomItem(SORTED[state.category]);
    state.used.add(state.left.iso2);
  }

  state.right = pickOpponent(state.left, state.category);
  state.used.add(state.right.iso2);
}

// Starts a fresh run in the given mode.
function startGame(mode) {
  state.mode = mode;
  state.streak = 0;
  state.used = new Set();
  state.left = null;
  state.right = null;
  state.busy = false;
  state.over = false;

  setUpRound();
  renderRound();
  el.best.textContent = getBest(GAME_ID, bestKey(mode));

  el.gameover.hidden = true;
  el.startScreen.hidden = true;
  el.gameScreen.hidden = false;
}

// ===========================================================================
// 5. GUESSING
// ===========================================================================

// Animates a number counting up from 0 to its real value.
function countUp(element, target) {
  return new Promise((resolve) => {
    if (reducedMotion) {
      element.textContent = formatValue(state.category, target);
      resolve();
      return;
    }

    const startTime = performance.now();

    // The browser calls "frame" about 60 times a second.
    function frame(now) {
      // progress goes from 0 (just started) to 1 (finished)
      const progress = Math.min((now - startTime) / COUNT_UP_MS, 1);
      // "Ease out": start fast, slow down near the end. Feels nicer.
      const eased = 1 - Math.pow(1 - progress, 3);

      element.textContent = formatValue(state.category, target * eased);

      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}

// Slides the right card over to the left, then deals a new right card.
async function slideToNextRound() {
  // Old left card fades out, right card moves across (see game.css).
  el.board.classList.add('sliding');
  await wait(reducedMotion ? 0 : SLIDE_MS);

  // The right-hand country becomes the new left-hand country.
  state.left = state.right;
  setUpRound();
  renderRound();

  // Snap the cards back to their normal spots (now showing new content)
  // and fade the new right card in.
  el.board.classList.remove('sliding');
  el.rightCard.classList.add('entering');
  el.rightCard.addEventListener(
    'animationend',
    () => el.rightCard.classList.remove('entering'),
    { once: true }
  );
}

// Called when the player guesses. direction is 'higher' or 'lower'.
async function guess(direction) {
  // Ignore guesses while an animation is running or the game is over.
  if (state.busy || state.over || el.gameScreen.hidden) return;
  state.busy = true;

  const leftValue = state.left.stats[state.category].value;
  const rightValue = state.right.stats[state.category].value;

  // >= and <= (rather than > and <) mean equal values count as correct.
  const correct =
    direction === 'higher' ? rightValue >= leftValue : rightValue <= leftValue;

  // Swap the buttons for the number, and count it up.
  el.guessButtons.hidden = true;
  const value = el.rightCard.querySelector('.value');
  const year = el.rightCard.querySelector('.year');
  value.hidden = false;
  year.hidden = false;
  await countUp(value, rightValue);

  // Show green or red, and give the player a moment to see it.
  el.rightCard.classList.add(correct ? 'correct' : 'wrong');
  await wait(RESULT_PAUSE_MS);

  if (correct) {
    state.streak += 1;
    el.streak.textContent = state.streak;
    await slideToNextRound();
    state.busy = false;
  } else {
    showGameOver(direction);
  }
}

// ===========================================================================
// 6. GAME OVER
// ===========================================================================

function showGameOver(direction) {
  state.over = true;
  state.busy = false;

  // Save the streak if it's a new best for this mode.
  const isNewBest = saveBest(GAME_ID, bestKey(state.mode), state.streak);
  const best = getBest(GAME_ID, bestKey(state.mode));

  // e.g. "Population · Hard"
  el.modeLabel.textContent = `${modeLabel(state.mode)} · ${DIFFICULTIES[state.difficulty].label}`;
  el.newBest.hidden = !isNewBest;
  el.finalStreak.textContent = state.streak;
  el.finalBest.textContent = best;
  el.best.textContent = best;

  // Explain the answer, e.g.
  //   You said Higher. The answer was Lower.
  //   Japan     124 million
  //   Mexico    130 million
  const label = CATEGORIES[state.category].label;
  const rightAnswer = direction === 'higher' ? 'Lower' : 'Higher';
  const youSaid = direction === 'higher' ? 'Higher' : 'Lower';
  const leftStat = state.left.stats[state.category];
  const rightStat = state.right.stats[state.category];

  el.answerBox.innerHTML = `
    <p class="answer-summary">
      ${label}: you said ${youSaid}, the answer was <strong>${rightAnswer}</strong>.
    </p>
    <div class="answer-row">
      <span>${state.right.name}</span>
      <strong>${formatValue(state.category, rightStat.value)}</strong>
    </div>
    <div class="answer-row">
      <span>${state.left.name}</span>
      <strong>${formatValue(state.category, leftStat.value)}</strong>
    </div>
  `;

  el.shareButton.textContent = 'Share';
  el.gameover.hidden = false;
  el.playAgainButton.focus();
}

// Copies a brag message to the clipboard, e.g.
// "Guess It 🌍 Higher or Lower: Population (Hard), streak 14"
async function share() {
  const difficulty = DIFFICULTIES[state.difficulty].label;
  const text = `Guess It 🌍 Higher or Lower: ${modeLabel(state.mode)} (${difficulty}), streak ${state.streak}`;

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

el.higherButton.addEventListener('click', () => guess('higher'));
el.lowerButton.addEventListener('click', () => guess('lower'));
el.backButton.addEventListener('click', showStartScreen);
el.playAgainButton.addEventListener('click', () => startGame(state.mode));
el.changeCategoryButton.addEventListener('click', showStartScreen);
el.shareButton.addEventListener('click', share);

// Keyboard: up arrow = Higher, down arrow = Lower.
document.addEventListener('keydown', (event) => {
  // Only while a round is being played.
  if (el.gameScreen.hidden || state.over) return;

  if (event.key === 'ArrowUp') {
    event.preventDefault(); // stop the page scrolling
    guess('higher');
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    guess('lower');
  }
});

// If a flag picture fails to load, hide the broken-image icon.
for (const flag of document.querySelectorAll('.flag')) {
  flag.addEventListener('error', () => {
    flag.style.visibility = 'hidden';
  });
}

// Go! Add the header and show the category picker.
renderHeader('../../');
showStartScreen();
