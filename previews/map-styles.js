// previews/map-styles.js
//
// Draws the preview maps on map-styles.html. This is a scratch file for
// choosing a look; the real games use games/border-chain/map.js.

import mapData from '../data/map.json';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

// The areas of the map to show: [x, y, width, height] in map units.
const VIEWS = {
  world: [0, 420, 5000, 2600],
  europe: [2290, 1385, 720, 432],
};

// An example round to colour in, so the game colours can be judged too.
const EXAMPLE = {
  PT: 'start',
  ES: 'chain',
  FR: 'chain',
  DE: 'chain',
  PL: 'end',
  IT: 'wrong',
};

// The same projection numbers as scripts/fetch-map.js, needed to draw the
// faint latitude and longitude lines in the right places.
const WIDTH = mapData.width;
const scale = WIDTH / (2 * Math.PI);
const mercator = (latitude) =>
  Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360));
const top = mercator(84);
const xOf = (longitude) => ((longitude + 180) / 360) * WIDTH;
const yOf = (latitude) => (top - mercator(latitude)) * scale;

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
  return element;
}

let mapCount = 0;

function drawMap(svg) {
  const view = VIEWS[svg.dataset.view];
  const blank = 'blank' in svg.dataset;
  const id = `map${mapCount++}`; // each map needs its own names for effects
  svg.setAttribute('viewBox', view.join(' '));
  if (blank) svg.classList.add('is-blank');

  // --- Effects: a sea gradient and a soft glow around the coastline ---
  const defs = svgElement('defs');
  const gradient = svgElement('radialGradient', {
    id: `${id}-sea`,
    cx: '50%',
    cy: '45%',
    r: '75%',
  });
  gradient.append(
    svgElement('stop', { offset: '0%', class: 'sea-inner' }),
    svgElement('stop', { offset: '100%', class: 'sea-outer' })
  );

  // The glow is a blurred copy of the land sitting behind it. Its size is
  // tied to the zoom level so it looks the same in every view.
  const glow = svgElement('filter', {
    id: `${id}-coast`,
    x: '-10%',
    y: '-10%',
    width: '120%',
    height: '120%',
  });
  glow.append(
    svgElement('feDropShadow', {
      dx: 0,
      dy: 0,
      stdDeviation: view[2] * 0.004,
      class: 'coast-glow',
    })
  );
  defs.append(gradient, glow);
  svg.append(defs);

  // --- Sea ---
  svg.append(
    svgElement('rect', {
      x: view[0],
      y: view[1],
      width: view[2],
      height: view[3],
      fill: `url(#${id}-sea)`,
    })
  );

  // --- Latitude and longitude lines, every 15 degrees ---
  let lines = '';
  for (let longitude = -180; longitude <= 180; longitude += 15) {
    lines += `M${xOf(longitude)} 0V${mapData.height}`;
  }
  for (let latitude = -45; latitude <= 75; latitude += 15) {
    lines += `M0 ${yOf(latitude)}H${WIDTH}`;
  }
  svg.append(svgElement('path', { class: 'grid', d: lines }));

  // --- Land ---
  const land = svgElement('g', { filter: `url(#${id}-coast)` });
  land.append(svgElement('path', { class: 'other-land', d: mapData.background }));
  const coloured = [];
  for (const [code, shape] of Object.entries(mapData.countries)) {
    const path = svgElement('path', { class: 'country', d: shape.d });
    if (EXAMPLE[code]) {
      path.dataset.state = EXAMPLE[code];
      coloured.push(path); // drawn last so their outlines sit on top
    } else {
      land.append(path);
    }
  }
  svg.append(land);
  for (const path of coloured) svg.append(path);
}

for (const svg of document.querySelectorAll('svg[data-style]')) drawMap(svg);
