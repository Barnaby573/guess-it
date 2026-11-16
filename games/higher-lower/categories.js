// games/higher-lower/categories.js
//
// The list of categories the player can choose, and how to turn each raw
// number into nice text (e.g. 68720337 -> "68.7 million").

// Turns a big number into words: 1,430,000,000 -> "1.43 billion".
// Numbers under a million are shown in full with commas: "11,396".
function bigNumber(value) {
  const units = [
    [1e12, 'trillion'],
    [1e9, 'billion'],
    [1e6, 'million'],
  ];
  for (const [size, name] of units) {
    if (value >= size) {
      // toPrecision(3) keeps 3 significant digits: 68.7, 1.43, 545.
      // Wrapping in Number() removes pointless zeros ("3.00" -> "3").
      return `${Number((value / size).toPrecision(3))} ${name}`;
    }
  }
  return wholeNumber(value);
}

// Rounds to a whole number and adds commas: 243610.4 -> "243,610".
function wholeNumber(value) {
  return Math.round(value).toLocaleString('en-US');
}

// Each category has:
//   label  - the name shown to the player
//   emoji  - a little icon for the category button
//   format - a function that turns the raw number into display text
//
// The keys (population, gdp, ...) match the stat names in countries.json.
export const CATEGORIES = {
  population: {
    label: 'Population',
    emoji: '👥',
    format: (value) => bigNumber(value),
  },
  gdp: {
    label: 'GDP',
    emoji: '💰',
    format: (value) => `$${bigNumber(value)}`,
  },
  gdpPerCapita: {
    label: 'GDP per capita',
    emoji: '💵',
    format: (value) => `$${wholeNumber(value)}`,
  },
  area: {
    label: 'Area',
    emoji: '🗺️',
    format: (value) => `${wholeNumber(value)} km²`,
  },
  lifeExpectancy: {
    label: 'Life expectancy',
    emoji: '❤️',
    format: (value) => `${value.toFixed(1)} years`,
  },
  density: {
    label: 'Density',
    emoji: '🏙️',
    // Small densities get one decimal place (3.4), big ones don't (8,129).
    format: (value) =>
      `${value < 100 ? value.toFixed(1) : wholeNumber(value)} people per km²`,
  },
};

// Shortcut: format a value for a given category key.
export function formatValue(categoryKey, value) {
  return CATEGORIES[categoryKey].format(value);
}
