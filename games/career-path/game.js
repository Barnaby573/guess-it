// games/career-path/game.js
//
// Career Path for football. All the game logic is shared with the other
// sports, in career-game.js. This file just starts it with footballers.

import data from '../../data/footballers.json';
import { startCareerGame } from './career-game.js';

startCareerGame({
  gameId: 'career-path',
  data,
  shareTitle: 'Guess It ⚽ Career Path',
  sportName: 'football',
});
