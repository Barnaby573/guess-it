// games/border-chain/game.js
//
// The Border Chain game: get from a start country to a target country by
// naming the countries in between.
//
// How this file is organised:
//   1. Setup          - imports, options, and grabbing elements from the page
//   2. Options screen - the Rules / Map / Distance pickers
//   3. Starting       - choosing a start and target, and the opening zoom
//   4. Entering       - what happens when the player names a country
//   5. Drawing        - the chain of chips, the scores and the map colours
//   6. Finishing      - the result pop-up, new round, share
//   7. Typing         - the text box and its suggestion list
//   8. Wiring up      - connecting buttons to the functions above
//
// Two helper files do the specialist work:
//   routes.js - which countries connect, and shortest routes
//   map.js    - drawing and zooming the map

import data from '../../data/countries.json';
import { renderHeader } from '../../shared/header.js';
import { loadSetting, saveSetting } from '../../shared/storage.js';
import { createCountrySearch } from '../../shared/country-search.js';
import {
  sharesBorder,
  shortestRoute,
  pickPair,
  linkedToStart,
} from './routes.js';
import { createMap } from './map.js';

// ===========================================================================
// 1. SETUP
// ===========================================================================

// THE OPTIONS
//
// Each group becomes a row of buttons on the options screen. To add a
// choice, add a line here; its button appears automatically.
//
// For Distance, "crossings" is the number of borders crossed on the
// shortest route. The number of countries you must name is one fewer:
// Portugal -> Spain -> France is 2 crossings but only 1 country to name.
const OPTIONS = {
  rules: {
    label: 'Rules',
    choices: {
      strict: {
        label: 'Strict chain',
        help: 'Each country must border the one you are on.',
      },
      free: {
        label: 'Free entry',
        help: 'Name countries in any order. You win when they link up.',
      },
    },
  },
  map: {
    label: 'Map',
    choices: {
      outlines: { label: 'Outlines', help: 'Every border is drawn for you.' },
      blank: { label: 'Blank', help: 'Just the land, with no borders drawn.' },
    },
  },
  distance: {
    label: 'Distance',
    choices: {
      short: { label: 'Short', help: '1 or 2 countries in between.', min: 2, max: 3 },
      medium: { label: 'Medium', help: '3 to 5 countries in between.', min: 4, max: 6 },
      long: { label: 'Long', help: '6 or more countries in between.', min: 7, max: Infinity },
    },
  },
};

// What the player has chosen. Starts with sensible defaults, then anything
// remembered from a previous visit is laid on top.
const choices = { rules: 'strict', map: 'outlines', distance: 'short' };
const remembered = loadSetting('border-chain:options', {});
for (const group of Object.keys(OPTIONS)) {
  // Only trust a remembered value if that choice still exists.
  if (OPTIONS[group].choices[remembered[group]]) {
    choices[group] = remembered[group];
  }
}

// A quick way to look up a country by its 2-letter code.
const COUNTRY = Object.fromEntries(
  data.countries.map((country) => [country.iso2, country])
);
const nameOf = (code) => COUNTRY[code].name;

const search = createCountrySearch(data.countries);

// Everything that changes during a round lives in this one object.
const state = {
  start: null, // code of the start country
  end: null, // code of the target country
  best: 0, // fewest goes possible (countries on the shortest route)
  goes: 0, // how many countries the player has entered
  entries: [], // codes the player has entered, in order
  status: {}, // code -> 'chain' (on the route), 'wrong' or 'loose'
  current: null, // strict rules only: the country the player is on
  over: false,
};

// The map is a big file, so it loads in the background after the page
// appears. "map" stays null until it is ready.
let map = null;
// Timers for the opening zoom, so we can cancel it if the player is quick.
let introTimers = [];

const el = {
  optionsScreen: document.getElementById('options-screen'),
  optionGroups: document.getElementById('option-groups'),
  playButton: document.getElementById('play-button'),
  gameScreen: document.getElementById('game-screen'),
  backButton: document.getElementById('back-button'),
  goes: document.getElementById('goes'),
  best: document.getElementById('best'),
  startName: document.getElementById('start-name'),
  endName: document.getElementById('end-name'),
  mapSvg: document.getElementById('map'),
  legendExtra: document.getElementById('legend-extra'),
  zoomInButton: document.getElementById('zoom-in-button'),
  zoomOutButton: document.getElementById('zoom-out-button'),
  zoomFitButton: document.getElementById('zoom-fit-button'),
  form: document.getElementById('entry-form'),
  input: document.getElementById('entry-input'),
  suggestions: document.getElementById('suggestions'),
  message: document.getElementById('message'),
  chain: document.getElementById('chain'),
  giveUpButton: document.getElementById('give-up-button'),
  result: document.getElementById('result'),
  resultTitle: document.getElementById('result-title'),
  resultSubtitle: document.getElementById('result-subtitle'),
  finalGoes: document.getElementById('final-goes'),
  finalBest: document.getElementById('final-best'),
  routeBox: document.getElementById('route-box'),
  newRoundButton: document.getElementById('new-round-button'),
  changeOptionsButton: document.getElementById('change-options-button'),
  shareButton: document.getElementById('share-button'),
};

// ===========================================================================
// 2. OPTIONS SCREEN
// ===========================================================================

// Draws the three rows of option buttons. Redrawn whenever one is pressed,
// so the highlight and the help text stay up to date.
function renderOptions() {
  el.optionGroups.innerHTML = '';

  for (const [groupKey, group] of Object.entries(OPTIONS)) {
    const row = document.createElement('div');
    row.className = 'option-group';

    const label = document.createElement('p');
    label.className = 'option-label';
    label.textContent = group.label;

    const picker = document.createElement('div');
    picker.className = 'picker';
    picker.setAttribute('role', 'group');
    picker.setAttribute('aria-label', group.label);

    for (const [choiceKey, choice] of Object.entries(group.choices)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'picker-button';
      button.textContent = choice.label;
      // aria-pressed marks the selected button (game.css highlights it).
      button.setAttribute('aria-pressed', choices[groupKey] === choiceKey);
      button.addEventListener('click', () => {
        choices[groupKey] = choiceKey;
        saveSetting('border-chain:options', choices);
        renderOptions();
      });
      picker.append(button);
    }

    // One line explaining the currently selected choice.
    const help = document.createElement('p');
    help.className = 'option-help';
    help.textContent = group.choices[choices[groupKey]].help;

    row.append(label, picker, help);
    el.optionGroups.append(row);
  }
}

function showOptionsScreen() {
  cancelIntro();
  el.result.hidden = true;
  el.gameScreen.hidden = true;
  el.optionsScreen.hidden = false;
  renderOptions();
}

// ===========================================================================
// 3. STARTING A ROUND
// ===========================================================================

function startRound() {
  if (!map) return; // the map hasn't finished loading yet

  const distance = OPTIONS.distance.choices[choices.distance];
  const pair = pickPair(distance.min, distance.max);

  state.start = pair.start;
  state.end = pair.end;
  // You don't name the start or the target, so the fewest goes possible
  // is one less than the number of borders crossed.
  state.best = pair.crossings - 1;
  state.goes = 0;
  state.entries = [];
  state.status = {};
  state.current = pair.start;
  state.over = false;

  // Show the game screen BEFORE moving the map. A hidden map has no size,
  // so the camera couldn't work out how to frame things.
  el.result.hidden = true;
  el.optionsScreen.hidden = true;
  el.gameScreen.hidden = false;

  map.reset(choices.map === 'blank');
  // The fourth legend entry depends on the rules: strict has wrong answers
  // (red), free entry has countries waiting to be linked up (amber).
  const isStrict = choices.rules === 'strict';
  el.legendExtra.dataset.state = isStrict ? 'wrong' : 'loose';
  el.legendExtra.textContent = isStrict ? 'Wrong' : 'Not linked yet';

  el.startName.textContent = nameOf(state.start);
  el.endName.textContent = nameOf(state.end);
  setMessage(
    choices.rules === 'strict'
      ? `Name a country that borders ${nameOf(state.start)}.`
      : 'Name any country to place it on the map.'
  );
  el.input.value = '';
  showSuggestions([]);
  render();
  playIntro();
  el.input.focus();
}

// The opening camera move: look at the start country, then the target,
// then pull back so both are in view.
function playIntro() {
  cancelIntro();
  map.focusOn([state.start], 900);
  introTimers = [
    setTimeout(() => map.focusOn([state.end], 1100), 1700),
    setTimeout(() => map.focusOn([state.start, state.end], 1000), 3500),
  ];
}

function cancelIntro() {
  for (const timer of introTimers) clearTimeout(timer);
  introTimers = [];
}

// ===========================================================================
// 4. ENTERING A COUNTRY
// ===========================================================================

// Called when the player names a country. "country" is one of the objects
// from countries.json.
function enter(country) {
  if (state.over) return;
  cancelIntro();

  const outcome =
    choices.rules === 'strict'
      ? enterStrict(country.iso2)
      : enterFree(country.iso2);

  setMessage(outcome.message, outcome.tone);
  render();
  if (outcome.won) finish(true);
}

// STRICT RULES: each new country must border the one you are on.
// Returns { message, tone, won }.
function enterStrict(code) {
  const name = nameOf(code);
  const here = nameOf(state.current);

  if (code === state.end) {
    return {
      message: `You finish by reaching a neighbour of ${name}. ${here} doesn't border it.`,
    };
  }

  // Naming the start, or a country already on your chain, takes you back
  // there. This is free, and it's how you escape a dead end.
  if (code === state.start || state.status[code] === 'chain') {
    if (code === state.current) return { message: `You're already in ${name}.` };
    state.current = code;
    return { message: `Back to ${name}. Where next?` };
  }

  const borders = sharesBorder(state.current, code);

  // A country you got wrong earlier (shown in red). It was wrong from where
  // you stood then, but it might be right from where you stand now.
  if (state.status[code] === 'wrong') {
    if (!borders) {
      // Still wrong. You've already paid a go for this mistake.
      return { message: `${name} still doesn't border ${here}.` };
    }
    // Now it's a real move. Take it out of the list so it can be added
    // again below, at the end, where it belongs in the chain.
    state.entries = state.entries.filter((entry) => entry !== code);
  }

  // Every real attempt costs a go, right or wrong.
  state.goes += 1;
  state.entries.push(code);

  if (!borders) {
    state.status[code] = 'wrong';
    return { message: `${name} doesn't border ${here}.`, tone: 'bad' };
  }

  state.status[code] = 'chain';
  state.current = code;
  return {
    message: `${name} borders ${here}.`,
    tone: 'good',
    // You've made it once you're standing next to the target.
    won: sharesBorder(code, state.end),
  };
}

// FREE ENTRY: name countries in any order. You win when they form an
// unbroken route from the start to the target.
function enterFree(code) {
  const name = nameOf(code);

  if (code === state.start || code === state.end) {
    return { message: `${name} is already on the map.` };
  }
  if (state.status[code]) {
    return { message: `You've already entered ${name}.` };
  }

  state.goes += 1;
  state.entries.push(code);

  // Work out afresh which entered countries are linked to the start,
  // because one new country can join several loose ones to the route.
  const linked = linkedToStart(state.start, state.entries);
  for (const entry of state.entries) {
    state.status[entry] = linked.has(entry) ? 'chain' : 'loose';
  }

  const isLinked = linked.has(code);
  return {
    message: isLinked
      ? `${name} is linked to your route.`
      : `${name} isn't linked to your route yet.`,
    // Not linked yet isn't a mistake, so it gets amber rather than red.
    tone: isLinked ? 'good' : 'waiting',
    won: [...linked].some((linkedCode) => sharesBorder(linkedCode, state.end)),
  };
}

// ===========================================================================
// 5. DRAWING
// ===========================================================================

// Shows a line of feedback under the text box.
// tone is 'good' (green), 'bad' (red), 'waiting' (amber) or left out (neutral).
function setMessage(text, tone = 'info') {
  el.message.textContent = text;
  el.message.dataset.tone = tone;
}

// Redraws everything that depends on the state: the scores, the chain of
// chips under the map, and the colours on the map.
function render() {
  el.goes.textContent = state.goes;
  el.best.textContent = state.best;

  // --- Map colours ---
  map.setState(state.start, 'start');
  map.setState(state.end, 'end');
  for (const code of state.entries) {
    map.setState(code, state.status[code]);
  }
  // Under strict rules, show which country you are standing on.
  if (choices.rules === 'strict' && state.current !== state.start) {
    map.setState(state.current, 'current');
  }
  // Keep everything the player has named in view. (The opening zoom
  // handles the camera until the first entry.)
  // If the player has zoomed or dragged the map themselves, "follow" leaves
  // their view alone as long as the newest country is on screen.
  if (state.entries.length > 0) {
    map.follow(everythingInPlay(), state.entries[state.entries.length - 1]);
  }

  // --- Chain of chips ---
  el.chain.innerHTML = '';
  el.chain.append(makeChip(state.start, 'start'));
  for (const code of state.entries) {
    el.chain.append(makeChip(code, state.status[code]));
  }
  el.chain.append(makeChip(state.end, 'end'));
}

// Every country that matters this round: the start, the target and
// everything the player has named. Used for framing the map.
function everythingInPlay() {
  return [state.start, state.end, ...state.entries];
}

// Builds one chip: a small rounded label for a country.
function makeChip(code, status) {
  // Under strict rules, chips on your chain are buttons: press one to go
  // back to that country.
  const canGoBack =
    choices.rules === 'strict' &&
    !state.over &&
    (status === 'start' || status === 'chain');

  const chip = document.createElement(canGoBack ? 'button' : 'span');
  chip.className = 'chip';
  chip.dataset.state = status;
  chip.textContent = nameOf(code);

  if (choices.rules === 'strict' && code === state.current) {
    chip.classList.add('chip-current');
  }
  if (canGoBack) {
    chip.type = 'button';
    chip.title = `Go back to ${nameOf(code)}`;
    chip.addEventListener('click', () => enter(COUNTRY[code]));
  }
  return chip;
}

// ===========================================================================
// 6. FINISHING
// ===========================================================================

// Ends the round. won = false means the player gave up.
function finish(won) {
  state.over = true;
  cancelIntro();
  render(); // redraw so the chips stop being buttons

  const extra = state.goes - state.best;
  if (!won) {
    el.resultTitle.textContent = 'Round over';
    el.resultSubtitle.textContent = 'Here is how it could be done.';
  } else if (extra === 0) {
    el.resultTitle.textContent = 'Perfect route!';
    el.resultSubtitle.textContent = 'You found the shortest way there.';
  } else {
    el.resultTitle.textContent = 'You made it!';
    el.resultSubtitle.textContent = `${extra} more ${extra === 1 ? 'go' : 'goes'} than the shortest route.`;
  }

  el.finalGoes.textContent = state.goes;
  el.finalBest.textContent = state.best;

  // Show one of the shortest routes, e.g. "Portugal → Spain → France".
  const route = shortestRoute(state.start, state.end);
  el.routeBox.innerHTML = '<p class="route-label">A shortest route</p>';
  const routeText = document.createElement('p');
  routeText.textContent = route.map(nameOf).join(' → ');
  el.routeBox.append(routeText);

  el.shareButton.hidden = !won;
  el.shareButton.textContent = 'Share';
  el.result.hidden = false;
  el.newRoundButton.focus();
}

// Copies a brag message to the clipboard, e.g.
// "Guess It 🔗 Border Chain: Portugal → Poland in 4 goes (best possible 3)"
async function share() {
  const goes = `${state.goes} ${state.goes === 1 ? 'go' : 'goes'}`;
  const text = `Guess It 🔗 Border Chain: ${nameOf(state.start)} → ${nameOf(state.end)} in ${goes} (best possible ${state.best})`;

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
// 7. TYPING
// ===========================================================================

// The countries currently offered under the text box, and which one (if
// any) is highlighted with the arrow keys. -1 means none.
let suggested = [];
let highlighted = -1;

function showSuggestions(countries) {
  suggested = countries;
  highlighted = -1;
  el.suggestions.innerHTML = '';
  el.suggestions.hidden = countries.length === 0;

  for (const country of countries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'suggestion';
    button.textContent = country.name;
    // "mousedown" fires before the text box loses focus. Stopping it here
    // keeps the keyboard open on phones when a suggestion is tapped.
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => submitCountry(country));
    el.suggestions.append(button);
  }
}

// Moves the highlight up or down the suggestion list.
function moveHighlight(change) {
  if (suggested.length === 0) return;
  // The % makes it wrap around from the bottom back to the top.
  highlighted = (highlighted + change + suggested.length) % suggested.length;
  [...el.suggestions.children].forEach((button, index) => {
    button.classList.toggle('is-highlighted', index === highlighted);
  });
}

// Enters a country and gets the text box ready for the next one.
function submitCountry(country) {
  el.input.value = '';
  showSuggestions([]);
  enter(country);
  el.input.focus();
}

// Called when the player presses Enter (or the Enter button).
function submitTyped() {
  // If a suggestion is highlighted with the arrow keys, use that.
  if (highlighted >= 0) {
    submitCountry(suggested[highlighted]);
    return;
  }

  const typed = el.input.value.trim();
  if (typed === '') return;

  const match = search.resolve(typed);
  if (!match) {
    // Not recognised: no go is used.
    setMessage(
      `"${typed}" isn't a country I recognise. Check the spelling or pick from the list.`
    );
    return;
  }
  submitCountry(match.country);
}

// ===========================================================================
// 8. WIRING UP
// ===========================================================================

el.playButton.addEventListener('click', startRound);
el.backButton.addEventListener('click', showOptionsScreen);
el.giveUpButton.addEventListener('click', () => finish(false));
el.newRoundButton.addEventListener('click', startRound);
el.changeOptionsButton.addEventListener('click', showOptionsScreen);
el.shareButton.addEventListener('click', share);

// The zoom buttons in the corner of the map.
el.zoomInButton.addEventListener('click', () => map.zoomBy(0.6));
el.zoomOutButton.addEventListener('click', () => map.zoomBy(1 / 0.6));
el.zoomFitButton.addEventListener('click', () => {
  cancelIntro();
  map.focusOn(everythingInPlay());
});

el.form.addEventListener('submit', (event) => {
  event.preventDefault(); // stop the browser reloading the page
  submitTyped();
});

el.input.addEventListener('input', () => {
  showSuggestions(search.suggest(el.input.value));
});

el.input.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveHighlight(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveHighlight(-1);
  } else if (event.key === 'Escape') {
    showSuggestions([]);
  }
});

// Load the map in the background. Until it arrives, the Play button says
// "Loading map..." and can't be pressed.
async function loadMap() {
  try {
    // import() fetches a file only when asked, so the big map file
    // doesn't slow down the first paint of the page.
    const mapData = (await import('../../data/map.json')).default;
    map = createMap(el.mapSvg, mapData);
    el.playButton.disabled = false;
    el.playButton.textContent = 'Play';
  } catch {
    el.playButton.textContent = 'Map failed to load. Refresh to try again.';
  }
}

// Go! Add the header, show the options and start loading the map.
renderHeader('../../');
showOptionsScreen();
loadMap();
