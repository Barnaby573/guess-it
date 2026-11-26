// games/career-path/career-game.js
//
// All the logic for the Career Path games: guess the player from their
// clubs. Shared by every sport. Each sport's page starts it with its own
// players, for example games/career-path/game.js:
//
//   startCareerGame({
//     gameId: 'career-path',            // used in the localStorage keys
//     data: footballers,                // from scripts/fetch-careers.js
//     shareTitle: 'Guess It ⚽ Career Path',
//     sportName: 'football',            // used in the Hard description
//   });
//
// How a round works:
//   - Clue 1 is the player's nation and position.
//   - Each wrong guess (or "Next clue") shows the next club, oldest first.
//   - After every club, the last clue is the player's initials.
//   - Guessing on clue 1 scores 6 points, clue 2 scores 5... down to 1.
//   - Wrong after the last clue: 0 points, and the answer is shown.
// A game is 10 players, so the most you can score is 60.
//
// How this file is organised:
//   1. Setup        - imports, settings, and grabbing elements from the page
//   2. Start screen - the difficulty buttons
//   3. A round      - choosing a player and drawing the clue card
//   4. Guessing     - typed guesses, next clue, ending a round
//   5. Game over    - the final screen, play again, share
//   6. Typing       - the text box and its suggestion list
//   7. Wiring up    - connecting buttons and keys to the functions above
//   8. Starting     - startCareerGame(), which each sport's page calls

import { renderHeader } from '../../shared/header.js';
import { getBest, saveBest, loadSetting, saveSetting } from '../../shared/storage.js';
import { createPlayerSearch } from './player-search.js';

// ===========================================================================
// 1. SETUP
// ===========================================================================

// These are set by startCareerGame() (at the bottom of this file).
let GAME_ID; // used in the localStorage keys, e.g. 'career-path'
let SHARE_TITLE; // the start of the share message
let data; // the sport's players
let search; // turns typed names into players

const PLAYERS_PER_GAME = 10;
const MAX_POINTS = 6; // for a correct guess on the very first clue

// The time frame buttons: only players who were still playing at some
// point in the last this-many years can come up. The data file covers 30
// years (see scripts/fetch-careers.js), so don't go higher than that.
const TIME_FRAMES = [10, 15, 20, 30];
const DEFAULT_TIME_FRAME = 20;

// The difficulty buttons. Players in the chosen time frame are sorted from
// most to least famous, then split into thirds. "third" says which one:
// 0 = the most famous third, 2 = the least famous. Mixed uses them all.
const DIFFICULTIES = {
  easy: { label: 'Easy', third: 0, note: 'The most famous names.' },
  medium: { label: 'Medium', third: 1, note: 'Well-known, but not quite superstars.' },
  hard: { label: 'Hard', third: 2, note: 'For people who really know their sport.' },
  mixed: { label: 'Mixed', third: null, note: 'Anyone, from easy to hard.' },
};
const DEFAULT_DIFFICULTY = 'easy';

// Everything that changes while playing lives in this one object.
const state = {
  difficulty: DEFAULT_DIFFICULTY, // the saved choices are loaded at the start
  timeFrame: DEFAULT_TIME_FRAME,
  queue: [], // the 10 players for this game
  roundIndex: 0, // which of the 10 we're on (0 to 9)
  player: null, // the player for this round
  cluesShown: 1, // how many clues are showing (1 = just nation and position)
  guessed: new Set(), // wrong names already tried this round
  score: 0,
  results: [], // { player, points } for each finished round
  roundOver: false,
};

// Grab the page elements we need, once.
const el = {
  startScreen: document.getElementById('start-screen'),
  timePicker: document.getElementById('time-picker'),
  difficultyPicker: document.getElementById('difficulty-picker'),
  difficultyNote: document.getElementById('difficulty-note'),
  playButton: document.getElementById('play-button'),
  startBest: document.getElementById('start-best'),
  gameScreen: document.getElementById('game-screen'),
  backButton: document.getElementById('back-button'),
  roundNumber: document.getElementById('round-number'),
  score: document.getElementById('score'),
  clueCard: document.getElementById('clue-card'),
  nationFlag: document.getElementById('nation-flag'),
  nationName: document.getElementById('nation-name'),
  position: document.getElementById('position'),
  worth: document.getElementById('worth'),
  career: document.getElementById('career'),
  initials: document.getElementById('initials'),
  reveal: document.getElementById('reveal'),
  revealLabel: document.getElementById('reveal-label'),
  revealName: document.getElementById('reveal-name'),
  guessArea: document.getElementById('guess-area'),
  form: document.getElementById('entry-form'),
  input: document.getElementById('entry-input'),
  suggestions: document.getElementById('suggestions'),
  clueButton: document.getElementById('clue-button'),
  nextButton: document.getElementById('next-button'),
  message: document.getElementById('message'),
  gameover: document.getElementById('gameover'),
  modeLabel: document.getElementById('mode-label'),
  newBest: document.getElementById('new-best'),
  finalScore: document.getElementById('final-score'),
  finalBest: document.getElementById('final-best'),
  results: document.getElementById('results'),
  playAgainButton: document.getElementById('play-again-button'),
  changeDifficultyButton: document.getElementById('change-difficulty-button'),
  shareButton: document.getElementById('share-button'),
};

// --- Small helpers ---------------------------------------------------------

// Shuffles a list into a random order (the "Fisher-Yates" shuffle) and
// returns a new list, leaving the original alone.
function shuffled(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Loads a saved choice (difficulty or time frame). "options" is the list
// or object of allowed values. Only trust the saved value if it's still
// one of them, otherwise use the fallback.
function loadChoice(name, options, fallback) {
  const saved = loadSetting(`${GAME_ID}:${name}`, fallback);
  const allowed = Array.isArray(options) ? options.includes(saved) : saved in options;
  return allowed ? saved : fallback;
}

// The players who can come up with the current settings.
function playerPool() {
  // 1. Only players still playing in the time frame. lastYear is the year
  //    they stopped, or null if they're still playing.
  const firstYear = new Date().getFullYear() - state.timeFrame;
  const inTimeFrame = data.players
    .filter((player) => player.lastYear === null || player.lastYear >= firstYear)
    .sort((a, b) => b.fame - a.fame); // most famous first

  // 2. Take the right third for the difficulty (Mixed takes them all).
  const { third } = DIFFICULTIES[state.difficulty];
  if (third === null) return inTimeFrame;
  const size = Math.ceil(inTimeFrame.length / 3);
  return inTimeFrame.slice(third * size, (third + 1) * size);
}

// Best scores are saved separately for each difficulty AND time frame,
// e.g. "hard-20", so a Hard score never competes with an Easy one.
function bestKey() {
  return `${state.difficulty}-${state.timeFrame}`;
}

// e.g. "Hard · last 20 years"
function settingsLabel() {
  return `${DIFFICULTIES[state.difficulty].label} · last ${state.timeFrame} years`;
}

// The web address of a nation's flag. England, Scotland, Wales and
// Northern Ireland have codes like "gb-eng", which flagcdn.com understands.
function flagUrl(code) {
  return `https://flagcdn.com/w160/${code}.png`;
}

// "Lionel Messi" -> "L. M."    "Ronaldinho" -> "R."
function initialsOf(name) {
  return name
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + '.')
    .join(' ');
}

// 2004 and 2021 -> "2004–2021".  Still there -> "2023–"
// A start year we don't know shows as "?": "?–2010".
function yearsText(club) {
  return `${club.from ?? '?'}–${club.to ?? ''}`;
}

// Total clues for a player: nation/position, one per club, then initials.
function totalClues(player) {
  return 1 + player.clubs.length + 1;
}

// Points for a correct guess with this many clues showing: 6, 5, 4... 1.
function pointsFor(cluesShown) {
  return Math.max(1, MAX_POINTS - (cluesShown - 1));
}

// ===========================================================================
// 2. START SCREEN
// ===========================================================================

function showStartScreen() {
  el.gameover.hidden = true;
  el.gameScreen.hidden = true;
  el.startScreen.hidden = false;

  // The 10 / 15 / 20 / 30 years buttons.
  fillPicker(
    el.timePicker,
    TIME_FRAMES.map((years) => ({ value: years, label: `${years} years` })),
    'timeFrame',
    'time-frame'
  );

  // The Easy / Medium / Hard / Mixed buttons.
  fillPicker(
    el.difficultyPicker,
    Object.entries(DIFFICULTIES).map(([key, d]) => ({ value: key, label: d.label })),
    'difficulty',
    'difficulty'
  );

  // e.g. "The most famous names. 117 players."
  const count = playerPool().length;
  el.difficultyNote.textContent = `${DIFFICULTIES[state.difficulty].note} ${count} players.`;
  const best = getBest(GAME_ID, bestKey());
  el.startBest.textContent = best > 0 ? `Your best: ${best} / 60` : 'Not played yet';
}

// Fills a row of picker buttons. The chosen one is highlighted.
//   options:    [{ value, label }, ...]
//   stateKey:   which part of "state" the buttons change
//   settingKey: the name the choice is saved under
function fillPicker(picker, options, stateKey, settingKey) {
  picker.innerHTML = '';
  for (const { value, label } of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'picker-button'; // styled in shared/game-ui.css
    button.textContent = label;
    // aria-pressed tells screen readers which one is selected,
    // and the stylesheet uses it to highlight the button.
    button.setAttribute('aria-pressed', value === state[stateKey]);
    button.addEventListener('click', () => {
      state[stateKey] = value;
      saveSetting(`${GAME_ID}:${settingKey}`, value);
      showStartScreen(); // redraw so the highlight and best score update
    });
    picker.append(button);
  }
}

// ===========================================================================
// 3. A ROUND
// ===========================================================================

function startGame() {
  state.queue = shuffled(playerPool()).slice(0, PLAYERS_PER_GAME);
  state.roundIndex = 0;
  state.score = 0;
  state.results = [];

  el.gameover.hidden = true;
  el.startScreen.hidden = true;
  el.gameScreen.hidden = false;
  startRound();
}

function startRound() {
  state.player = state.queue[state.roundIndex];
  state.cluesShown = 1;
  state.guessed = new Set();
  state.roundOver = false;

  // Clue 1: nation and position. These never change during the round.
  const { nation, position } = state.player;
  el.nationFlag.style.visibility = 'visible';
  el.nationFlag.src = flagUrl(nation.flag);
  el.nationFlag.alt = `Flag of ${nation.name}`;
  el.nationName.textContent = nation.name;
  // A few players have no position in the data, so this line can be empty.
  el.position.textContent = position ?? '';

  el.roundNumber.textContent = state.roundIndex + 1;
  el.score.textContent = state.score;
  el.reveal.hidden = true;
  el.clueCard.classList.remove('is-right', 'is-wrong');
  el.guessArea.hidden = false;
  el.nextButton.hidden = true;
  el.input.value = '';
  showSuggestions([]);
  setMessage('');

  drawClues();
  el.input.focus();
}

// Draws the career list, the initials and the "worth" label to match how
// many clues are showing. Called whenever a new clue appears.
function drawClues() {
  const { player, cluesShown, roundOver } = state;
  // Clue 1 is nation/position, so clubs start at clue 2.
  // When the round is over, everything is shown.
  const clubsShown = roundOver ? player.clubs.length : Math.min(cluesShown - 1, player.clubs.length);

  el.career.innerHTML = '';
  // One row for each club shown so far.
  player.clubs.slice(0, clubsShown).forEach((club, index) => {
    const row = document.createElement('li');
    row.className = 'club';
    row.innerHTML = `
      <span class="club-years"></span>
      <span class="club-name"></span>
    `;
    // textContent (not innerHTML) for data, so odd characters in a club
    // name can never break the page.
    row.querySelector('.club-years').textContent = yearsText(club);
    row.querySelector('.club-name').textContent = club.name;
    if (club.loan) {
      const loan = document.createElement('span');
      loan.className = 'club-loan';
      loan.textContent = 'loan';
      row.append(loan);
    }
    // Make the newest club fade in (but not when everything is revealed).
    if (index === clubsShown - 1 && !roundOver) row.classList.add('is-new');
    el.career.append(row);
  });

  // One faded row saying how many clubs are still hidden, e.g.
  // "4 more clubs to come". (Knowing how long the career is helps a bit.)
  const hidden = player.clubs.length - clubsShown;
  if (hidden > 0) {
    const row = document.createElement('li');
    row.className = 'club is-hidden';
    row.innerHTML = '<span class="club-years">????</span><span class="club-name"></span>';
    row.querySelector('.club-name').textContent =
      `${hidden} ${clubsShown === 0 ? '' : 'more '}${hidden === 1 ? 'club' : 'clubs'} to come`;
    el.career.append(row);
  }

  const initialsShown = roundOver || cluesShown >= totalClues(player);
  el.initials.hidden = !initialsShown;
  el.initials.textContent = `Initials: ${initialsOf(player.name)}`;

  // e.g. "Worth 4 pts". Hidden once the round is over.
  el.worth.hidden = roundOver;
  el.worth.innerHTML = `Worth <strong>${pointsFor(cluesShown)}</strong> ${pointsFor(cluesShown) === 1 ? 'pt' : 'pts'}`;

  // On the last clue, "Next clue" becomes "Give up".
  el.clueButton.textContent = cluesShown >= totalClues(player) ? 'Give up' : 'Next clue';
}

// ===========================================================================
// 4. GUESSING
// ===========================================================================

function setMessage(text) {
  el.message.textContent = text;
}

// Shows the next clue, or ends the round if there are none left.
function nextClue() {
  if (state.roundOver) return;
  if (state.cluesShown >= totalClues(state.player)) {
    endRound(false);
  } else {
    state.cluesShown += 1;
    drawClues();
  }
}

// Called with the player (footballer, rugby player...) that was guessed.
function guess(player) {
  if (state.roundOver) return;

  if (player === state.player) {
    endRound(true);
    return;
  }

  // Guessing the same wrong name twice costs nothing.
  if (state.guessed.has(player)) {
    setMessage(`You've already tried ${player.name}.`);
    return;
  }
  state.guessed.add(player);

  if (state.cluesShown >= totalClues(state.player)) {
    endRound(false);
  } else {
    setMessage(`Not ${player.name}. Here's another clue.`);
    nextClue();
  }
}

function endRound(correct) {
  const points = correct ? pointsFor(state.cluesShown) : 0;
  state.roundOver = true;
  state.score += points;
  state.results.push({ player: state.player, points });

  drawClues(); // shows the whole career and the initials
  el.score.textContent = state.score;
  el.clueCard.classList.add(correct ? 'is-right' : 'is-wrong');
  el.revealLabel.textContent = correct
    ? `Correct! +${points} ${points === 1 ? 'point' : 'points'}`
    : 'Unlucky! It was';
  el.revealName.textContent = state.player.name;
  el.reveal.hidden = false;

  el.guessArea.hidden = true;
  showSuggestions([]);
  setMessage('');

  const last = state.roundIndex === PLAYERS_PER_GAME - 1 || state.roundIndex === state.queue.length - 1;
  el.nextButton.textContent = last ? 'See your score →' : 'Next player →';
  el.nextButton.hidden = false;
  el.nextButton.focus();
}

function nextRound() {
  if (state.roundIndex >= state.queue.length - 1) {
    showGameOver();
  } else {
    state.roundIndex += 1;
    startRound();
  }
}

// ===========================================================================
// 5. GAME OVER
// ===========================================================================

function showGameOver() {
  const isNewBest = saveBest(GAME_ID, bestKey(), state.score);
  const best = getBest(GAME_ID, bestKey());

  el.modeLabel.textContent = settingsLabel();
  el.newBest.hidden = !isNewBest;
  el.finalScore.textContent = state.score;
  el.finalBest.textContent = best;

  // One row per player, e.g. "Kaká ........ 4"
  el.results.innerHTML = '';
  for (const { player, points } of state.results) {
    const row = document.createElement('li');
    row.className = points > 0 ? 'result-right' : 'result-wrong';
    const name = document.createElement('span');
    name.textContent = player.name;
    const score = document.createElement('strong');
    score.textContent = points;
    row.append(name, score);
    el.results.append(row);
  }

  el.shareButton.textContent = 'Share';
  el.gameover.hidden = false;
  el.playAgainButton.focus();
}

// Copies a brag message to the clipboard, e.g.
// "Guess It ⚽ Career Path (Hard · last 20 years): 41/60  🟩🟩🟨🟥..."
async function share() {
  // One square per player: green = got it fast, yellow = slow, red = missed.
  const squares = state.results
    .map(({ points }) => (points >= 4 ? '🟩' : points > 0 ? '🟨' : '🟥'))
    .join('');
  const text = `${SHARE_TITLE} (${settingsLabel()}): ${state.score}/60\n${squares}`;

  try {
    await navigator.clipboard.writeText(text);
    el.shareButton.textContent = 'Copied!';
  } catch {
    // Some browsers block clipboard access. Let the player copy it by hand.
    window.prompt('Copy your result:', text);
  }
}

// ===========================================================================
// 6. TYPING
// ===========================================================================

// The players currently offered under the text box, and which one (if
// any) is highlighted with the arrow keys. -1 means none.
let suggested = [];
let highlighted = -1;

function showSuggestions(players) {
  suggested = players;
  highlighted = -1;
  el.suggestions.innerHTML = '';
  el.suggestions.hidden = players.length === 0;

  for (const player of players) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'suggestion';
    button.textContent = player.name;
    // "mousedown" fires before the text box loses focus. Stopping it here
    // keeps the keyboard open on phones when a suggestion is tapped.
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => submitPlayer(player));
    el.suggestions.append(button);
  }
}

// Moves the highlight up or down the suggestion list.
function moveHighlight(change) {
  if (suggested.length === 0) return;
  highlighted = (highlighted + change + suggested.length) % suggested.length;
  [...el.suggestions.children].forEach((button, index) => {
    button.classList.toggle('is-highlighted', index === highlighted);
  });
}

function submitPlayer(player) {
  el.input.value = '';
  showSuggestions([]);
  guess(player);
  if (!state.roundOver) el.input.focus();
}

// Called when the player presses Enter (or the Guess button).
function submitTyped() {
  if (highlighted >= 0) {
    submitPlayer(suggested[highlighted]);
    return;
  }

  const typed = el.input.value.trim();
  if (typed === '') return;

  const player = search.resolve(typed);
  if (!player) {
    // Not recognised: no clue is used up.
    setMessage(`"${typed}" isn't a player I know. Try their full name, or pick from the list.`);
    return;
  }
  submitPlayer(player);
}

// ===========================================================================
// 7. WIRING UP
// ===========================================================================

el.playButton.addEventListener('click', startGame);
el.backButton.addEventListener('click', showStartScreen);
el.clueButton.addEventListener('click', () => {
  setMessage('');
  nextClue();
});
el.nextButton.addEventListener('click', nextRound);
el.playAgainButton.addEventListener('click', startGame);
el.changeDifficultyButton.addEventListener('click', showStartScreen);
el.shareButton.addEventListener('click', share);

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

// If a flag picture fails to load, hide the broken-image icon.
el.nationFlag.addEventListener('error', () => {
  el.nationFlag.style.visibility = 'hidden';
});

// ===========================================================================
// 8. STARTING
// ===========================================================================

// Called once by each sport's page (see the top of this file).
export function startCareerGame(config) {
  GAME_ID = config.gameId;
  SHARE_TITLE = config.shareTitle;
  data = config.data;
  DIFFICULTIES.hard.note = `For people who really know their ${config.sportName}.`;

  // Every guess is checked against all the players, whatever the settings,
  // so the suggestions don't give away which players are in play.
  search = createPlayerSearch(data.players);

  state.difficulty = loadChoice('difficulty', DIFFICULTIES, DEFAULT_DIFFICULTY);
  state.timeFrame = loadChoice('time-frame', TIME_FRAMES, DEFAULT_TIME_FRAME);

  // Go! Add the header and show the settings.
  renderHeader('../../');
  showStartScreen();
}
