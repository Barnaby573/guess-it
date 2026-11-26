// scripts/sports/rugby.js
//
// Settings for fetching rugby union players. Used by scripts/fetch-careers.js:
//   npm run fetch-rugby
//
// Run it again each summer to pick up moves.

export default {
  label: 'rugby union players',
  output: 'rugby-players.json', // saved in the data folder

  // Wikidata's ID for "rugby union player".
  occupation: 'Q14089670',

  playerCount: 300, // how many players end up in the game

  // Rugby players have pages in fewer languages than footballers, so the
  // bar for being considered is much lower.
  minPages: 5,

  // Fame = English page views x the number of languages with a page on
  // the player. Page views alone put TV personalities (Strictly, I'm a
  // Celebrity) above the all-time greats, because rugby gets far fewer
  // views than football. The greats have pages in many more languages.
  fameIncludesLanguages: true,

  // Rugby players often have no "country for sport" on Wikidata, but they
  // are listed as members of their national team. Use that team's country.
  nationFromNationalTeam: true,

  // Wikidata rarely gets an end year when a rugby player retires, so most
  // retired players would look like they're still playing. Read the club
  // years from each player's Wikipedia info box instead.
  endYearsFromWikipedia: true,

  // Ireland plays as one team for the whole island, so Northern Irish
  // players show as Ireland. (These are Wikidata IDs.)
  nationOverrides: {
    Q26: { name: 'Ireland', flag: 'ie' }, // Northern Ireland
    Q22890: { name: 'Ireland', flag: 'ie' }, // the island of Ireland
  },

  // Players to leave out by hand, with the reason.
  leaveOut: {
    'Herschelle Gibbs': 'a cricketer who played rugby at school',
    'Peter Kirsten': 'a cricketer who played rugby at school',
    'Peter Claffey': 'far better known as an actor, so ranked far too high',
  },

  // Nations to set by hand, where Wikidata's choice isn't the one fans know.
  nationFixes: {},

  // ---- Team names that are not a club ----
  // Wikidata lists national, age-group, invitational and university
  // teams alongside clubs. We spot them by their names.
  notAFirstTeam: [
    /\bnational\b/i, // "Wales national rugby union team"
    /\bunder[- ]?\d+/i, // "under-20"
    /\bU-?\d{2}\b/i, // "U20"
    /\bsevens\b/i,
    /\bbarbarian/i, // "Barbarian F.C.", the invitational side
    /british (&|and) irish lions/i,
    /\b(wolfhounds|saxons|emerging|classic)\b/i, // second national sides
    /\bm[aā]ori\b/i, // Māori All Blacks, New Zealand Māori rugby league team
    /\ball blacks\b/i, // "Junior All Blacks"
    /\bpacific islanders\b/i,
    /\bXV\b/, // "New Zealand XV", "World XV", "President's XV"
    /\s(A)$/, // "Ireland A", "Scotland A"
    /\b(university|college|varsity|schools?|schoolboys?)\b/i,
    /\bikey tigers\b/i, // University of Cape Town
    /\b(academy|youth|development|juniors?)\b/i,
    /\bhemisphere\b/i, // one-off charity matches
    /\bcricket\b/i, // a few players also played cricket
    /\bhealth board\b/i, // an employer, listed as a team by mistake
  ],

  // ---- Positions ----
  // Rugby positions are shown as they are. Earlier entries are checked
  // first, so "wing forward" counts as a flanker, not a wing.
  positions: [
    { name: 'Prop', words: ['prop'] },
    { name: 'Hooker', words: ['hooker'] },
    { name: 'Lock', words: ['lock', 'second row'] },
    { name: 'Flanker', words: ['flanker', 'wing forward', 'openside', 'blindside'] },
    { name: 'Number 8', words: ['number 8', 'number eight', 'no. 8'] },
    { name: 'Back row', words: ['back row', 'loose forward', 'third line'] },
    { name: 'Scrum-half', words: ['scrum-half', 'scrum half', 'halfback'] },
    { name: 'Fly-half', words: ['fly-half', 'fly half', 'first five', 'out-half', 'stand-off'] },
    { name: 'Centre', words: ['centre', 'center', 'second five'] },
    { name: 'Wing', words: ['wing'] },
    { name: 'Full-back', words: ['full-back', 'fullback', 'full back'] },
  ],

  // ---- Shorter club names ----
  // "Leinster Rugby" -> "Leinster", "Dragons RFC" -> "Dragons",
  // "CA Brive" -> "Brive". ("\\." is a full stop.)
  trimEnd: [
    'Rugby Football Union', 'Rugby Football Club', '[Rr]ugby [Uu]nion [Tt]eam', 'Rugby Union',
    'Rugby Club', 'Rugby', 'Football Club', 'R\\.F\\.C\\.', 'RFC', 'DRUFC', 'RUFC',
    'R\\.F\\.U\\.', 'RFU', 'RU', 'F\\.C\\.', 'FC', 'RC',
  ],
  trimStart: ['Rugby Club', 'Football Club', 'RC', 'USA', 'ASM', 'CA', 'CS', 'SU', 'US', 'AS', 'FC'],

  // Names the trimming can't work out, written in full.
  clubNames: {
    'RC Toulonnais': 'Toulon',
    'Stade Toulousain': 'Toulouse',
    'Castres Olympique': 'Castres',
    'ASM Clermont Auvergne': 'Clermont',
    'Union Bordeaux Bègles': 'Bordeaux Bègles',
    'Section Paloise': 'Pau',
    'Aviron Bayonnais': 'Bayonne',
    'Montpellier Hérault Rugby': 'Montpellier',
    'Lyon OU': 'Lyon',
    'Harlequin F.C.': 'Harlequins',
    'Canterbury RFU': 'Canterbury',
  },
};
