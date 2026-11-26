// games/rugby-path/game.js
//
// Career Path for rugby union. All the game logic is shared with football,
// in games/career-path/career-game.js. This file just starts it with
// rugby players (made by "npm run fetch-rugby").

import data from '../../data/rugby-players.json';
import { startCareerGame } from '../career-path/career-game.js';

startCareerGame({
  gameId: 'rugby-path',
  data,
  shareTitle: 'Guess It 🏉 Rugby Career Path',
  sportName: 'rugby',
});
