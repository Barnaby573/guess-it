// scripts/fetch-map.js
//
// Downloads country shapes and turns them into a compact file the browser
// can draw quickly: data/map.json. Used by the Border Chain game.
//
// Run it with:   npm run fetch-map
//
// Source: Natural Earth (public domain map data), 1:50m scale.
//
// What this script does to the raw data:
//   1. Flattens the globe onto a rectangle (a "map projection").
//   2. Rounds every point to a whole number, which shrinks the file a lot.
//   3. Writes each country as an SVG path: the text format browsers use to
//      draw shapes.

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SOURCE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';

// ---- Map projection ---------------------------------------------------------
// We use the Mercator projection, the same one most online maps use.
// The finished map is 5000 units wide. Units are just our own measuring
// scale; the browser stretches the map to fit the screen.
const WIDTH = 5000;
const MAX_LATITUDE = 84; // cut off the empty Arctic
const MIN_LATITUDE = -58; // cut off Antarctica

const scale = WIDTH / (2 * Math.PI);
const mercator = (latitude) =>
  Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360));
const top = mercator(MAX_LATITUDE);
const HEIGHT = Math.round((top - mercator(MIN_LATITUDE)) * scale);

// Turns [longitude, latitude] into [x, y] on our flat map.
function project([longitude, latitude]) {
  const clamped = Math.max(MIN_LATITUDE, Math.min(MAX_LATITUDE, latitude));
  return [((longitude + 180) / 360) * WIDTH, (top - mercator(clamped)) * scale];
}

// ---- Our rulings --------------------------------------------------------------
// A few shapes in the source have no ISO code. Tell the script who they
// belong to (matching how the World Bank counts countries).
const CODE_BY_NAME = {
  Somaliland: 'SO',
  'N. Cyprus': 'CY',
};

// France's shape in the source includes far-away regions like French Guiana
// in South America. The game uses mainland borders only, so any piece of
// France outside this box around Europe is drawn as plain background land.
const FRANCE_MAINLAND = { west: -12, east: 15, south: 40, north: 52 };

// A country smaller than this (in map units) is too small to see, so the
// game draws a dot on top of it. Examples: Monaco, San Marino, Andorra.
const TINY_SIZE = 12;

// ---- Shape helpers ------------------------------------------------------------

// The area enclosed by a ring of points (the "shoelace formula").
function ringArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

// The smallest box that contains all the points: [x, y, width, height].
function boundingBox(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX - minX, maxY - minY];
}

// Turns a ring of projected points into SVG path text.
//
// decimals = 0 rounds to whole numbers (small file). Neighbouring countries
// share the exact same border points in the source, so rounding them the
// same way keeps their borders lined up with no gaps.
// decimals = 1 keeps one decimal place, used only for tiny countries that
// would otherwise round away to nothing.
//
// Returns null if the ring is too small to draw at this precision.
function ringToPath(points, decimals) {
  const factor = 10 ** decimals;
  const round = (value) => Math.round(value * factor) / factor;

  // Round, then drop points that landed on top of the previous one.
  const kept = [];
  for (const [x, y] of points) {
    const point = [round(x), round(y)];
    const last = kept[kept.length - 1];
    if (!last || last[0] !== point[0] || last[1] !== point[1]) kept.push(point);
  }
  // A ring's last point repeats its first; the "z" below closes it instead.
  const first = kept[0];
  const last = kept[kept.length - 1];
  if (kept.length > 1 && first[0] === last[0] && first[1] === last[1]) kept.pop();

  if (kept.length < 3) return null;

  // "M x y" moves the pen to the start. "l dx dy" draws a line by a small
  // step from the previous point (steps are shorter to write than full
  // coordinates). "z" closes the shape.
  let path = `M${kept[0][0]} ${kept[0][1]}l`;
  const steps = [];
  for (let i = 1; i < kept.length; i++) {
    steps.push(
      Number((kept[i][0] - kept[i - 1][0]).toFixed(decimals)),
      Number((kept[i][1] - kept[i - 1][1]).toFixed(decimals))
    );
  }
  path += steps.join(' ') + 'z';
  return path;
}

// A GeoJSON shape is either one polygon or several ("MultiPolygon").
// This always gives back a list of polygons. Each polygon is a list of
// rings: the first ring is the outline, any others are holes (lakes etc).
function polygonsOf(feature) {
  return feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates]
    : feature.geometry.coordinates;
}

function isOutsideFranceMainland(polygon) {
  const [longitude, latitude] = polygon[0][0];
  const box = FRANCE_MAINLAND;
  return (
    longitude < box.west ||
    longitude > box.east ||
    latitude < box.south ||
    latitude > box.north
  );
}

async function main() {
  const dataFolder = resolve(import.meta.dirname, '..', 'data');

  // Our own list of countries, so the map uses the same 195 as every game.
  const ours = JSON.parse(
    await readFile(resolve(dataFolder, 'countries.json'), 'utf8')
  );
  const ourCodes = new Set(ours.countries.map((country) => country.iso2));

  console.log('Fetching map shapes (about 3 MB)...');
  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${SOURCE_URL}`);
  }
  const source = await response.json();

  // Collect the polygons for each of our countries, and everything else
  // (Greenland, Western Sahara, Taiwan...) as plain background land.
  const polygonsByCode = new Map();
  const backgroundPolygons = [];

  for (const feature of source.features) {
    const properties = feature.properties;
    const code = CODE_BY_NAME[properties.NAME] ?? properties.ISO_A2_EH;
    if (code === 'AQ') continue; // Antarctica is off the bottom of our map

    for (const polygon of polygonsOf(feature)) {
      const isOurs =
        ourCodes.has(code) &&
        !(code === 'FR' && isOutsideFranceMainland(polygon));

      if (isOurs) {
        if (!polygonsByCode.has(code)) polygonsByCode.set(code, []);
        polygonsByCode.get(code).push(polygon);
      } else {
        backgroundPolygons.push(polygon);
      }
    }
  }

  // ---- Build each country's path --------------------------------------------
  const countries = {};
  for (const [code, polygons] of polygonsByCode) {
    // Project every ring of every polygon onto the flat map.
    const projected = polygons.map((polygon) =>
      polygon.map((ring) => ring.map(project))
    );

    // Find the biggest piece (the "mainland"). The game zooms to this, so
    // far-off islands like Hawaii don't drag the view away.
    let mainland = projected[0];
    for (const polygon of projected) {
      if (ringArea(polygon[0]) > ringArea(mainland[0])) mainland = polygon;
    }

    const paths = [];
    for (const polygon of projected) {
      for (const [index, ring] of polygon.entries()) {
        let path = ringToPath(ring, 0);
        // The mainland outline must never vanish. If rounding to whole
        // numbers erased it (a tiny country), keep one decimal instead.
        if (!path && polygon === mainland && index === 0) {
          path = ringToPath(ring, 1);
        }
        if (path) paths.push(path);
      }
    }

    const box = boundingBox(mainland[0]).map((value) => Math.round(value * 10) / 10);
    countries[code] = { d: paths.join(''), box };
    if (Math.max(box[2], box[3]) < TINY_SIZE) countries[code].tiny = true;
  }

  // ---- Background land -------------------------------------------------------
  const backgroundPaths = [];
  for (const polygon of backgroundPolygons) {
    for (const ring of polygon) {
      const path = ringToPath(ring.map(project), 0);
      if (path) backgroundPaths.push(path);
    }
  }

  // ---- Save -------------------------------------------------------------------
  const output = {
    source: 'Natural Earth (naturalearthdata.com), public domain',
    width: WIDTH,
    height: HEIGHT,
    background: backgroundPaths.join(''),
    countries,
  };
  const text = JSON.stringify(output);
  await writeFile(resolve(dataFolder, 'map.json'), text + '\n');

  // ---- Report -----------------------------------------------------------------
  const missing = [...ourCodes].filter((code) => !countries[code]);
  const tiny = Object.keys(countries).filter((code) => countries[code].tiny);
  console.log(`\nSaved data/map.json (${Math.round(text.length / 1024)} KB)`);
  console.log(`  map size: ${WIDTH} x ${HEIGHT} units`);
  console.log(`  ${Object.keys(countries).length} of ${ourCodes.size} countries have a shape`);
  console.log(`  ${tiny.length} are tiny and get a dot: ${tiny.join(', ')}`);
  if (missing.length > 0) console.log(`  no shape for: ${missing.join(', ')}`);
}

main().catch((error) => {
  console.error('\nSomething went wrong:', error.message);
  process.exit(1);
});
