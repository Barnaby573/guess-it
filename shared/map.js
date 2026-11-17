// shared/map.js
//
// Draws the world map and moves the "camera" around it. Any game that
// needs a map uses this file (and its stylesheet, shared/map.css).
//
// The map is an SVG: a picture made of shapes described in text, which
// stays sharp at any zoom level. Zooming works by changing the SVG's
// "viewBox", which says which rectangle of the map is currently on screen.
//
// How this file is organised:
//   1. Drawing     - building the layers of the map
//   2. Camera      - gliding the view from place to place
//   3. By hand     - zooming, dragging and tapping
//   4. Marks       - the arrow and ring drawn on top of the map
//   5. Controls    - the functions a game can call

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

// Does this person's device ask for reduced motion? If so the camera jumps
// instead of gliding.
const reducedMotion = window.matchMedia(
  '(prefers-reduced-motion: reduce)'
).matches;

// Creates an SVG element (these need a special function, unlike HTML ones).
function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
  return element;
}

// Sets up the map inside the given <svg> element and returns a set of
// functions the game uses to control it.
//
// mapData is the contents of data/map.json.
// onPick (optional) is a function the map calls when the player taps or
// clicks the map without dragging it. It is given:
//   { code, point }
// code is the 2-letter code of the country tapped (or null for sea), and
// point is where on the map they tapped, as [x, y].
export function createMap(svg, mapData, { onPick } = {}) {
  const wholeWorld = [0, 0, mapData.width, mapData.height];

  // The rectangle currently on screen: [x, y, width, height].
  let view = wholeWorld;
  // Goes up by one each time a new camera move starts, so an older move
  // that is still running knows to stop.
  let moveNumber = 0;

  // ---- The map projection ---------------------------------------------------
  // These formulas turn a place on the globe into a place on our flat map,
  // and back again. They match scripts/fetch-map.js, which made the shapes.
  const mercator = (latitude) =>
    Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360));
  const scale = mapData.width / (2 * Math.PI);
  const topEdge = mercator(84); // the map's top edge is 84 degrees north

  // Globe -> map. Longitude is east/west, latitude is north/south.
  function project(longitude, latitude) {
    return [
      ((longitude + 180) / 360) * mapData.width,
      (topEdge - mercator(latitude)) * scale,
    ];
  }

  // Map -> globe. The reverse of project. Returns [longitude, latitude].
  function unproject(x, y) {
    const longitude = (x / mapData.width) * 360 - 180;
    const latitude =
      ((2 * Math.atan(Math.exp(topEdge - y / scale)) - Math.PI / 2) * 180) /
      Math.PI;
    return [longitude, latitude];
  }

  // ===========================================================================
  // 1. DRAWING
  // ===========================================================================
  svg.innerHTML = '';

  // The map is built in layers, bottom first:
  //   1. shallow water round the coasts   2. latitude/longitude lines
  //   3. land that isn't in play          4. the 195 countries
  //   5. dots for tiny countries          6. marks (arrow, ring)
  // (The sea itself is just the background colour of the map's frame.)

  // 1. Shallow water. All the land in one shape, drawn twice with thick
  //    pale outlines. The land layers above cover the inner half, leaving
  //    a soft pale band around every coast. See .map-halo in map.css.
  const allLand =
    mapData.background +
    Object.values(mapData.countries)
      .map((shape) => shape.d)
      .join('');
  svg.append(
    svgElement('path', { class: 'map-halo map-halo-wide', d: allLand }),
    svgElement('path', { class: 'map-halo map-halo-narrow', d: allLand })
  );

  // 2. Latitude and longitude lines, every 15 degrees.
  let gridLines = '';
  for (let longitude = -180; longitude <= 180; longitude += 15) {
    const [x] = project(longitude, 0);
    gridLines += `M${x} 0V${mapData.height}`; // a vertical line
  }
  for (let latitude = -45; latitude <= 75; latitude += 15) {
    const [, y] = project(0, latitude);
    gridLines += `M0 ${y}H${mapData.width}`; // a horizontal line
  }
  svg.append(svgElement('path', { class: 'map-grid', d: gridLines }));

  // 3. Land that isn't one of our 195 countries (Greenland, for example).
  svg.append(svgElement('path', { class: 'map-background', d: mapData.background }));

  // 4. The countries. Each remembers its code in "data-code", which is how
  //    we know which country was tapped.
  const shapes = {}; // code -> the country's <path>
  const dots = {}; // code -> a <circle>, only for tiny countries

  for (const [code, shape] of Object.entries(mapData.countries)) {
    shapes[code] = svgElement('path', {
      class: 'map-country',
      d: shape.d,
      'data-code': code,
    });
    svg.append(shapes[code]);
  }

  // 5. Tiny countries (Monaco, Andorra...) get a dot so they can be seen
  //    and tapped. Dots are added after the shapes so they sit on top.
  const dotLayer = svgElement('g');
  for (const [code, shape] of Object.entries(mapData.countries)) {
    if (!shape.tiny) continue;
    const [x, y, width, height] = shape.box;
    dots[code] = svgElement('circle', {
      class: 'map-dot',
      cx: x + width / 2,
      cy: y + height / 2,
      'data-code': code,
    });
    dotLayer.append(dots[code]);
  }
  svg.append(dotLayer);

  // 6. Marks drawn over everything else. Filled in by drawMarks() below.
  const markLayer = svgElement('g', { class: 'map-marks' });
  svg.append(markLayer);

  // ===========================================================================
  // 2. CAMERA
  // ===========================================================================

  // How many map units one screen pixel covers at the current zoom.
  function unitsPerPixel() {
    const units = Math.max(view[2] / svg.clientWidth, view[3] / svg.clientHeight);
    // A hidden map has no size, which would give a nonsense answer.
    // Fall back to a sensible guess (as if the map were 700 pixels wide).
    return Number.isFinite(units) && units > 0 ? units : view[2] / 700;
  }

  // Puts a rectangle of the map on screen.
  function showView(newView) {
    view = newView;
    svg.setAttribute('viewBox', newView.join(' '));
    // Dots and marks are sized in screen pixels, so they need redrawing
    // whenever the zoom changes.
    const radius = 6 * unitsPerPixel();
    for (const dot of Object.values(dots)) dot.setAttribute('r', radius);
    drawMarks();
  }

  // The smallest box containing all the given countries' mainlands.
  function boxAround(codes) {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const code of codes) {
      const [x, y, width, height] = mapData.countries[code].box;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + width);
      bottom = Math.max(bottom, y + height);
    }
    return [left, top, right - left, bottom - top];
  }

  // Adds breathing room around a box and stretches it to match the shape
  // of the map on screen, so nothing ends up hidden off the edge.
  function frame([x, y, width, height]) {
    const padding = Math.max(width, height) * 0.3 + 25;
    x -= padding;
    y -= padding;
    width += padding * 2;
    height += padding * 2;

    const screenShape = svg.clientWidth / svg.clientHeight || 1.6;
    if (width / height < screenShape) {
      const wider = height * screenShape;
      x -= (wider - width) / 2;
      width = wider;
    } else {
      const taller = width / screenShape;
      y -= (taller - height) / 2;
      height = taller;
    }
    return [x, y, width, height];
  }

  // Glides the camera from where it is now to a new view.
  function glideTo(target, milliseconds) {
    moveNumber += 1;
    const thisMove = moveNumber;

    if (reducedMotion || milliseconds === 0) {
      showView(target);
      return;
    }

    const from = view;
    const startTime = performance.now();

    function step(now) {
      if (thisMove !== moveNumber) return; // a newer move has taken over
      const progress = Math.min((now - startTime) / milliseconds, 1);
      // "Ease in and out": start slow, speed up, slow down to finish.
      const eased =
        progress < 0.5
          ? 2 * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      // Move each of x, y, width, height part of the way to its target.
      showView(from.map((value, i) => value + (target[i] - value) * eased));
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);

    // Safety net. Browsers pause animations in tabs that aren't visible.
    // If that happens, jump straight to the target once the time is up,
    // so the map is never left stuck in the wrong place.
    setTimeout(() => {
      if (thisMove === moveNumber) showView(target);
    }, milliseconds + 150);
  }

  // Is a country's mainland completely inside what's on screen right now?
  function isOnScreen(code) {
    const [x, y, width, height] = mapData.countries[code].box;
    return (
      x >= view[0] &&
      y >= view[1] &&
      x + width <= view[0] + view[2] &&
      y + height <= view[1] + view[3]
    );
  }

  // ===========================================================================
  // 3. BY HAND: zooming, dragging and tapping
  // ===========================================================================
  //
  // Mouse:  scroll wheel zooms, click-and-drag moves the map.
  // Touch:  one finger drags, two fingers pinch to zoom.
  // A press that doesn't move is a "pick": the player choosing a country.
  //
  // The browser reports mouse, finger and pen input the same way, as
  // "pointer events", so one set of code handles all of them.

  // True once the player has moved the map themselves. The game can then
  // avoid re-framing the map, so their view isn't snatched away.
  let userMoved = false;

  // How far you can zoom in and out, as the width of the view in map units.
  const NARROWEST = 30;
  const WIDEST = mapData.width * 1.3;

  // A press that moves less than this many pixels counts as a tap.
  const TAP_WOBBLE = 8;

  // Converts a position on the screen into a position on the map.
  function screenToMap(screenX, screenY) {
    const box = svg.getBoundingClientRect();
    const units = unitsPerPixel();
    // The view is centred in the map's box, so measure from the centre.
    return [
      view[0] + view[2] / 2 + (screenX - box.left - box.width / 2) * units,
      view[1] + view[3] / 2 + (screenY - box.top - box.height / 2) * units,
    ];
  }

  // The view you'd get by zooming around a point on the screen.
  // factor below 1 zooms in, above 1 zooms out. The map point under the
  // cursor (or between the fingers) stays exactly where it is.
  function zoomedView(factor, screenX, screenY) {
    const newWidth = Math.max(NARROWEST, Math.min(WIDEST, view[2] * factor));
    const actual = newWidth / view[2]; // the factor after applying the limits
    const [mapX, mapY] = screenToMap(screenX, screenY);
    return [
      mapX - (mapX - view[0]) * actual,
      mapY - (mapY - view[1]) * actual,
      view[2] * actual,
      view[3] * actual,
    ];
  }

  // Called whenever the player takes control of the map.
  function takeOver() {
    userMoved = true;
    moveNumber += 1; // stop any camera glide that is still running
  }

  svg.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault(); // zoom the map instead of scrolling the page
      takeOver();
      // deltaY is how far the wheel turned. Math.exp turns that into a
      // smooth multiplier: a small turn zooms a little, a big turn a lot.
      showView(zoomedView(Math.exp(event.deltaY * 0.0015), event.clientX, event.clientY));
    },
    { passive: false } // needed so preventDefault is allowed
  );

  // The fingers (or mouse button) currently down on the map: id -> position.
  const pointers = new Map();
  // Facts about the press in progress, used to tell a tap from a drag.
  let press = { travelled: 0, wasPinch: false };

  svg.addEventListener('pointerdown', (event) => {
    if (pointers.size === 0) press = { travelled: 0, wasPinch: false };
    else press.wasPinch = true; // a second finger has joined
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    // "Capture" keeps the drag going even if the pointer leaves the map.
    svg.setPointerCapture(event.pointerId);
  });

  svg.addEventListener('pointermove', (event) => {
    const before = pointers.get(event.pointerId);
    if (!before) return; // moving without pressing: nothing to do
    const now = { x: event.clientX, y: event.clientY };
    press.travelled += Math.hypot(now.x - before.x, now.y - before.y);

    if (pointers.size === 1) {
      // ONE finger or the mouse. Ignore tiny wobbles, so a slightly shaky
      // tap doesn't nudge the map.
      if (press.travelled >= TAP_WOBBLE) {
        const units = unitsPerPixel();
        takeOver();
        svg.classList.add('is-dragging');
        showView([
          view[0] - (now.x - before.x) * units,
          view[1] - (now.y - before.y) * units,
          view[2],
          view[3],
        ]);
      }
    } else if (pointers.size === 2) {
      // TWO fingers: compare how far apart they were with how far apart
      // they are now. Fingers spreading = zoom in, pinching = zoom out.
      const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)[1];
      const gapBefore = Math.hypot(before.x - other.x, before.y - other.y);
      const gapNow = Math.hypot(now.x - other.x, now.y - other.y);
      if (gapNow > 0 && gapBefore > 0) {
        takeOver();
        // Zoom around the point midway between the two fingers.
        showView(
          zoomedView(gapBefore / gapNow, (now.x + other.x) / 2, (now.y + other.y) / 2)
        );
      }
    }
    pointers.set(event.pointerId, now);
  });

  svg.addEventListener('pointerup', (event) => {
    const wasTap =
      pointers.has(event.pointerId) &&
      pointers.size === 1 &&
      !press.wasPinch &&
      press.travelled < TAP_WOBBLE;

    pointers.delete(event.pointerId);
    if (pointers.size === 0) svg.classList.remove('is-dragging');

    if (wasTap && onPick) {
      // Ask the browser what is drawn at that exact spot. If it's a
      // country (or a tiny country's dot) it will have a data-code.
      const element = document.elementFromPoint(event.clientX, event.clientY);
      onPick({
        code: element?.dataset?.code ?? null,
        point: screenToMap(event.clientX, event.clientY),
      });
    }
  });

  svg.addEventListener('pointercancel', (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size === 0) svg.classList.remove('is-dragging');
  });

  // ===========================================================================
  // 4. MARKS: the arrow and the ring
  // ===========================================================================

  // What is currently drawn on top of the map (null = nothing).
  let arrow = null; // { from: [x, y], to: [x, y] }
  let ringCode = null; // the country with a ring round it

  // Redraws the marks. Called whenever they change or the zoom changes,
  // so the arrow and ring always stay the same size on screen.
  function drawMarks() {
    markLayer.innerHTML = '';
    const pixel = unitsPerPixel(); // one screen pixel, in map units

    if (ringCode) {
      const [x, y, width, height] = mapData.countries[ringCode].box;
      // Big enough to surround the country, but never smaller than a
      // fingertip, so tiny countries get a ring you can actually see.
      const radius = Math.max(Math.hypot(width, height) / 2 + 8 * pixel, 26 * pixel);
      markLayer.append(
        svgElement('circle', {
          class: 'map-ring',
          cx: x + width / 2,
          cy: y + height / 2,
          r: radius,
        })
      );
    }

    if (arrow) {
      const [fromX, fromY] = arrow.from;
      // The direction to travel, as an angle.
      const angle = Math.atan2(arrow.to[1] - fromY, arrow.to[0] - fromX);
      // The arrow is a fixed length on screen. It shows which WAY to go,
      // not how far, so it doesn't simply point at the answer.
      const length = 70 * pixel;
      const tipX = fromX + Math.cos(angle) * length;
      const tipY = fromY + Math.sin(angle) * length;
      // The two short lines of the arrowhead, swept back from the tip.
      const barb = 18 * pixel;
      const sweep = 2.6; // about 150 degrees, in radians
      const head = [angle + sweep, angle - sweep]
        .map((a) => `M${tipX} ${tipY}L${tipX + Math.cos(a) * barb} ${tipY + Math.sin(a) * barb}`)
        .join('');
      const shape = `M${fromX} ${fromY}L${tipX} ${tipY}${head}`;

      markLayer.append(
        // Drawn twice: a pale thick copy underneath makes the dark arrow
        // stand out against any background.
        svgElement('path', { class: 'map-arrow map-arrow-edge', d: shape }),
        svgElement('path', { class: 'map-arrow', d: shape }),
        // A spot marking where the player tapped.
        svgElement('circle', { class: 'map-arrow-spot', cx: fromX, cy: fromY, r: 5 * pixel })
      );
    }
  }

  // ===========================================================================
  // 5. CONTROLS: what a game can ask the map to do
  // ===========================================================================
  return {
    project,
    unproject,

    // Clears all colours and marks and shows the whole world.
    // blank = true hides the border lines, leaving plain land (see map.css).
    reset(blank = false) {
      svg.classList.toggle('is-blank', blank);
      for (const code of Object.keys(shapes)) this.setState(code, null);
      arrow = null;
      ringCode = null;
      moveNumber += 1; // stop any camera move from the last round
      userMoved = false;
      showView(wholeWorld);
    },

    // Colours a country. state is a word such as 'start', 'end', 'chain',
    // 'wrong' or 'right' (the full list and their colours are in map.css),
    // or null to clear it.
    setState(code, state) {
      for (const element of [shapes[code], dots[code]]) {
        if (!element) continue;
        if (state) element.dataset.state = state;
        else delete element.dataset.state;
      }
      // Move a coloured country to the front so its outline isn't covered
      // by its neighbours.
      if (state) svg.insertBefore(shapes[code], dotLayer);
    },

    // Moves the camera so all the given countries are on screen. This also
    // hands control of the camera back to the game.
    focusOn(codes, milliseconds = 700) {
      userMoved = false;
      glideTo(frame(boxAround(codes)), milliseconds);
    },

    // Called after the player names a country. Normally this frames all the
    // given countries. But if the player has zoomed or dragged the map
    // themselves, their view is left alone, unless the newest country
    // would be off screen.
    follow(codes, newest) {
      if (userMoved && isOnScreen(newest)) return;
      this.focusOn(codes);
    },

    // Is this country fully in view at the moment?
    isOnScreen,

    // For the + and - buttons: zooms around the middle of the map.
    // factor below 1 zooms in, above 1 zooms out.
    zoomBy(factor) {
      const box = svg.getBoundingClientRect();
      const target = zoomedView(
        factor,
        box.left + box.width / 2,
        box.top + box.height / 2
      );
      takeOver();
      glideTo(target, 200);
    },

    // Draws an arrow starting at one map point and aimed at another.
    showArrow(from, to) {
      arrow = { from, to };
      drawMarks();
    },

    // Draws a ring round a country (pass null to remove it).
    showRing(code) {
      ringCode = code;
      drawMarks();
    },

    // Removes the arrow and the ring.
    clearMarks() {
      arrow = null;
      ringCode = null;
      drawMarks();
    },
  };
}
