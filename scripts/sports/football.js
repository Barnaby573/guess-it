// scripts/sports/football.js
//
// Settings for fetching footballers. Used by scripts/fetch-careers.js:
//   npm run fetch-footballers
//
// Run it again each summer, after the transfer window, to pick up moves.

export default {
  label: 'footballers',
  output: 'footballers.json', // saved in the data folder

  // Wikidata's ID for "association football player".
  occupation: 'Q937857',

  playerCount: 450, // how many players end up in the game

  // Only players with a page in at least this many languages of Wikipedia
  // are considered. Lower it to consider more players (the script gets slower).
  minPages: 35,

  // Fame = English Wikipedia page views only. (Also counting languages
  // filled Hard mode with Japanese players, who have unusually many.)
  fameIncludesLanguages: false,

  // Footballers have a "country for sport" on Wikidata that works well.
  nationFromNationalTeam: false,
  nationOverrides: {},

  // Players to leave out by hand, with the reason.
  leaveOut: {
    'Javier Milei': 'a politician who played youth football',
    'Jason Statham': 'an actor, not a footballer',
  },

  // Nations to set by hand, where Wikidata's choice isn't the one fans know.
  nationFixes: {
    // Played for France, then for French Guiana late in his career.
    'Florent Malouda': { name: 'France', flag: 'fr' },
  },

  // ---- Team names that are not a first team ----
  // Wikidata lists youth, reserve and national teams as clubs too. We spot
  // them by their names, e.g. "Barcelona B", "Bayern Munich II", "Jong Ajax".
  notAFirstTeam: [
    /\bnational\b/i, // "England national football team"
    /\bolympic\b/i,
    /\bunder[- ]?\d+/i, // "under-21"
    /\bU-?\d{2}\b/i, // "U21", "U-19"
    /\bsub-?\d{2}\b/i, // "Sub-20" (Spanish and Portuguese)
    /\b(reserves?|youth|academy|juvenil|juniors?|primavera|castilla)\b/i,
    /\batl[eè]tic\b/i, // "Barcelona Atlètic", Barcelona's second team
    /^jong\s/i, // "Jong Ajax", Dutch second teams
    /\s(B|C|II|III)$/, // "Sevilla B", "Bayern Munich II"
    /\bregional\b/i, // "Basque Country regional football team"
    /\bmestalla\b/i, // Valencia's second team
    /\bgeneration adidas\b/i, // a US training squad, not a club
    /\bautonomous\b/i, // "Asturias autonomous football team"
    /-2$/, // "Zenit-2", a Russian second team
    /\bsoccer\b/i, // US college teams: "Portland Pilots women's soccer"
  ],

  // ---- Positions ----
  // The broad positions shown in the game, and words that point to each.
  // Wikidata uses many detailed positions ("centre-back", "winger"...).
  // Some entries are odd ("10" for a playmaker, "wing half" for a winger),
  // so those are included too. Earlier entries are checked first, and a
  // draw goes to the later (more attacking) one.
  positions: [
    { name: 'Goalkeeper', words: ['goalkeeper'] },
    { name: 'Defender', words: ['defender', 'back', 'sweeper', 'libero'] },
    { name: 'Midfielder', words: ['midfield', 'playmaker', '10'] },
    { name: 'Forward', words: ['forward', 'striker', 'winger', 'wing'] },
  ],

  // ---- Shorter club names ----
  // Bits trimmed off the end and start of official names, so that
  // "Manchester United F.C." becomes "Manchester United" and "AFC Ajax"
  // becomes "Ajax". (These are pieces of a pattern: "\\." is a full stop.)
  trimEnd: [
    'F\\.\\s?C\\.?', 'A\\.F\\.C\\.', 'FC', 'CF', 'CFC', 'SC', 'S\\.C\\.', 'SFC',
    'OSC', 'UD', 'BC', 'FCO', 'PFC', 'K\\.V\\.', 'V\\.V\\.', 'S\\.K\\.', 'F\\.K\\.', 'FK',
    'J\\.K\\.', 'E\\.C\\.', 'F\\.R\\.', 'F\\.B\\.C\\.', 'S\\.S\\.', 'SAD', 'Calcio',
    'Football Club', 'Futebol Clube', 'Fútbol Club', 'Sports Club', 'Esporte Clube',
    'Atlético Clube', 'Futebol',
  ],
  trimStart: [
    'FC', 'F\\.C\\.', 'AFC', 'AS', 'A\\.S\\.', 'A\\.S\\.D\\.', 'ACF', 'SSC', 'SS',
    'U\\.C\\.', 'U\\.S\\.', 'US', 'S\\.L\\.', 'S\\.C\\.', 'SC', 'SBV', 'R\\.S\\.C\\.',
    'K\\.R\\.C\\.', 'K\\.S\\.K\\.', 'K\\.S\\.V\\.', 'A\\.C\\.', 'AC', 'AJ', 'GNK', 'HNK',
    'HŠK', 'NK', 'N\\.K\\.', 'OGC', 'RCD', 'RC', 'R\\.C\\.', 'SD', 'CD', 'C\\.D\\.',
    'C\\.A\\.', 'C\\.S\\.', 'CR', 'ES', 'E\\.C\\.', 'FK', 'PFC', 'P\\.A\\.S\\.', 'LB',
    'UD', 'SV', 'VfL', 'VfB', '1\\. FC', '1\\. FSV', 'TSG \\d{4}', 'Calcio',
    'Club Atlético', 'Clube Atlético', 'Esporte Clube', 'Sociedad Deportiva',
  ],

  // Names the trimming can't work out, written in full.
  clubNames: {
    'Real Madrid Club de Fútbol': 'Real Madrid',
    'FC Bayern Munich': 'Bayern Munich',
    'AC Milan': 'AC Milan',
    'Olympique de Marseille': 'Marseille',
    'Olympique Lyonnais': 'Lyon',
    'Fenerbahçe Istanbul': 'Fenerbahçe',
    'Delfino Pescara 1936': 'Pescara',
    'Real Betis Balompié': 'Real Betis',
    'Feyenoord Rotterdam': 'Feyenoord',
    'Club Atlético River Plate': 'River Plate',
    'Clube Atlético Mineiro': 'Atlético Mineiro',
    'Clube de Regatas do Flamengo': 'Flamengo',
    'S.C. Corinthians Paulista': 'Corinthians',
    'Sociedade Esportiva Palmeiras': 'Palmeiras',
    'Club Social y Deportivo Colo-Colo': 'Colo-Colo',
    'Club Athletico Paranaense': 'Athletico Paranaense',
    'Deportivo de A Coruña': 'Deportivo La Coruña',
    'RCD Espanyol de Barcelona': 'Espanyol',
    'Stade Rennais F.C.': 'Rennes',
    'América Futebol Clube': 'América Mineiro',
    'Mogi Mirim Esporte Clube': 'Mogi Mirim',
    'Red Bull New York': 'New York Red Bulls',
    'Athletic Club': 'Athletic Bilbao',
    'Los Angeles FC': 'Los Angeles FC',
    'Club Nacional de Football': 'Nacional',
    'Grêmio FBPA': 'Grêmio',
    'Bayer 04 Leverkusen': 'Bayer Leverkusen',
    'Montpellier Hérault Sport Club': 'Montpellier',
    'AIK Fotboll': 'AIK',
    'Club Brugge K.V.': 'Club Brugge',
    'Shabab AlAhli Dubai Club': 'Shabab Al Ahli',
    'Wydad Athletic Club': 'Wydad Casablanca',
    'RC Strasbourg Alsace': 'Strasbourg',
    'RC Celta de Vigo': 'Celta Vigo',
    'Stade Malherbe Caen': 'Caen',
    'En Avant de Guingamp': 'Guingamp',
    'ES Troyes AC': 'Troyes',
    'İstanbul Başakşehir F.K.': 'İstanbul Başakşehir',
    'Sint-Truidense V.V.': 'Sint-Truiden',
    'Aarhus Gymnastikforening': 'AGF Aarhus',
    'Tours FC.': 'Tours',
    // Names that would otherwise clash with a more famous club.
    'Clube Atlético Juventus': 'Juventus (São Paulo)',
    'Barcelona Esporte Clube': 'Barcelona EC',
    'Nacional Atlético Clube': 'Nacional AC',
    'C.D. Nacional': 'Nacional (Madeira)',
    'Barcelona S.C.': 'Barcelona SC (Ecuador)',
    'Arsenal Fútbol Club': 'Arsenal de Sarandí',
    'E.C. Vitória': 'Vitória (Bahia)',
    'Vitória S.C.': 'Vitória de Guimarães',
    'Vitória F.C.': 'Vitória de Setúbal',
    'CD Málaga': 'CD Málaga',
    'Al Ahli SC': 'Al Ahli (Qatar)',
    'Al Ahli FC': 'Al Ahli (Saudi Arabia)',
  },
};
