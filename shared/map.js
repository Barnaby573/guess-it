// shared/map.js
//
// Draws the world map and moves the "camera" around it. Any game that
// needs a map uses this file (and its stylesheet, shared/map.css).
//
// The map is an SVG: a picture made of shapes described in text, which
// stays sharp at any zoom level.
//
// HOW IT STAYS FAST
// Every shape is drawn ONCE, when the map is created, inside a single group
// (<g>) called "world". Panning and zooming never touch the shapes: they
// only change the world group's "transform" (how far it is moved and how
// much it is scaled). On top of that:
//   - Pan/zoom updates are bunched up and applied at most once per screen
//     refresh (using requestAnimationFrame), however fast the mouse,
//     trackpad or fingers send events.
//   - Rings, the hover highlight and marks are only resized when the zoom
//     level changes, not on every pan.
//   - While the map is moving, countries ignore the mouse, so the browser
//     doesn't have to work out hover effects mid-drag.
//
// HOW IT HELPS YOU TAP THE RIGHT COUNTRY (in games where you tap the map)
//   - Hover: the country under the mouse lifts up with a heavy ink outline.
//     Small countries grow more than big ones, so you can see them.
//   - Rings: small countries get a ring round them when zoomed out. Anywhere
//     inside the ring counts as that country. Zoom in and the ring goes,
//     because the country itself is big enough to see.
//   - Out of play: a game can grey out countries that can't be the answer.
//   - Hold to aim (touchscreens): press and hold, and a target appears just
//     above your finger. Slide it onto a country and let go to choose it.
//   - Near misses: a tap on the sea just beside a country counts as that
//     country.
//
// How this file is organised:
//   1. Drawing     - building the layers of the map
//   2. Camera      - working out and applying the view
//   3. Hover       - highlighting the country under the mouse or target
//   4. By hand     - zooming, dragging, tapping and holding to aim
//   5. Marks       - the arrow and ring drawn on top of the map
//   6. Controls    - the functions a game can call

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
// point is where on the map they tapped, as [x, y]. A country that has
// been greyed out with setPlayable can still be tapped; the game decides
// what to say.
// Hovering and holding to aim only happen on maps that have an onPick.
export function createMap(svg, mapData, { onPick } = {}) {
  const wholeWorld = [0, 0, mapData.width, mapData.height];

  // The rectangle of the map we want on screen: [x, y, width, height], in
  // map units. Changing this doesn't move anything by itself; render()
  // turns it into the world group's transform.
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
  // 1. DRAWING (happens once)
  // ===========================================================================
  svg.innerHTML = '';
  // No viewBox: one unit inside the <svg> is one screen pixel. All the
  // moving and scaling is done by the world group's transform instead.
  svg.removeAttribute('viewBox');

  // Everything on the map lives in this one group. Moving the map means
  // changing this group's transform and nothing else.
  const world = svgElement('g', { class: 'map-world' });
  svg.append(world);

  // The map is built in layers, bottom first:
  //   1. shallow water round the coasts   2. latitude/longitude lines
  //   3. land that isn't in play          4. the 195 countries
  //   5. rings for small countries        6. the hovered country
  //   7. marks (arrow, ring)
  // (The sea itself is just the background colour of the map's frame.)

  // Countries smaller than this (in map units) can get a ring.
  const RING_COUNTRY_SIZE = 40;

  // 1. Shallow water. All the land in one shape, drawn twice with thick
  //    pale outlines. The land layers above cover the inner half, leaving
  //    a soft pale band around every coast. See .map-halo in map.css.
  const allLand =
    mapData.background +
    Object.values(mapData.countries)
      .map((shape) => shape.d)
      .join('');
  world.append(
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
  world.append(svgElement('path', { class: 'map-grid', d: gridLines }));

  // 3. Land that isn't one of our 195 countries (Greenland, for example).
  world.append(svgElement('path', { class: 'map-background', d: mapData.background }));

  // 4. The countries. Each remembers its code in "data-code", which is how
  //    we know which country was tapped.
  const shapes = {}; // code -> the country's <path>
  const rings = {}; // code -> a <circle>, only for small countries

  for (const [code, shape] of Object.entries(mapData.countries)) {
    shapes[code] = svgElement('path', {
      class: 'map-country',
      d: shape.d,
      'data-code': code,
    });
    world.append(shapes[code]);
  }

  // 5. Rings round small countries (Monaco, Malta, Jamaica, Luxembourg...)
  //    so they can be seen and tapped when the map is zoomed out. Each one
  //    is a circle the whole inside of which counts as that country.
  //    They are added after the shapes so they sit on top. render() hides
  //    them once you've zoomed in far enough to see the country itself.
  const ringLayer = svgElement('g');
  for (const [code, shape] of Object.entries(mapData.countries)) {
    const [x, y, width, height] = shape.box;
    if (Math.max(width, height) >= RING_COUNTRY_SIZE) continue;
    rings[code] = svgElement('circle', {
      class: 'map-spot',
      cx: x + width / 2,
      cy: y + height / 2,
      'data-code': code,
    });
    ringLayer.append(rings[code]);
  }
  world.append(ringLayer);

  // 6. The lifted copy of the hovered country (see section 3, Hover).
  const hoverLayer = svgElement('g', { class: 'map-hover' });
  world.append(hoverLayer);

  // 7. Marks drawn over everything else. Filled in by drawMarks() below.
  const markLayer = svgElement('g', { class: 'map-marks' });
  world.append(markLayer);

  // The target shown above your finger while holding to aim. It's an
  // ordinary HTML element laid over the map, not part of the SVG.
  const aimTarget = document.createElement('div');
  aimTarget.className = 'map-aim';
  aimTarget.hidden = true;
  svg.parentElement.append(aimTarget);

  // ===========================================================================
  // 2. CAMERA
  // ===========================================================================

  // How many map units one screen pixel covers for the current view.
  function unitsPerPixel() {
    const units = Math.max(view[2] / svg.clientWidth, view[3] / svg.clientHeight);
    // A hidden map has no size, which would give a nonsense answer.
    // Fall back to a sensible guess (as if the map were 700 pixels wide).
    return Number.isFinite(units) && units > 0 ? units : view[2] / 700;
  }

  // The zoom level the rings and marks were last sized for.
  let sizedForZoom = null;

  // How rings behave, in screen pixels:
  const RING_RADIUS = 11; // the size of a ring
  const RING_UNTIL = 16; // a ring shows while its country is smaller than this
  // True while a render is waiting for the next screen refresh.
  let renderQueued = false;

  // Moves the world group so that "view" fills the map. This is the only
  // thing that runs on every frame of a pan or zoom.
  function render() {
    renderQueued = false;
    const width = svg.clientWidth;
    const height = svg.clientHeight;
    // A hidden map has no size. Skip; the resize watcher below calls
    // render again as soon as the map appears.
    if (!width || !height) return;

    // Scale so the whole view fits, then centre it (like a photo frame).
    const zoom = Math.min(width / view[2], height / view[3]);
    const moveX = (width - view[2] * zoom) / 2 - view[0] * zoom;
    const moveY = (height - view[3] * zoom) / 2 - view[1] * zoom;
    world.setAttribute('transform', `translate(${moveX} ${moveY}) scale(${zoom})`);

    // Rings, the hover highlight and marks are sized in screen pixels, so
    // they only need updating when the zoom changes. A pan leaves them alone.
    if (zoom !== sizedForZoom) {
      sizedForZoom = zoom;
      const radius = RING_RADIUS / zoom; // in map units
      for (const [code, ring] of Object.entries(rings)) {
        const [, , w, h] = mapData.countries[code].box;
        // How big the country looks on screen right now, in pixels.
        const onScreen = Math.max(w, h) * zoom;
        ring.classList.toggle('is-hidden', onScreen >= RING_UNTIL);
        ring.setAttribute('r', radius);
      }
      drawHover();
      drawMarks();
    }
  }

  // Changes the view. By default the actual move waits for the next screen
  // refresh, so a burst of mouse or touch events causes just one redraw.
  // now = true redraws straight away (used when we're already inside a
  // screen refresh, or when nothing should be in between).
  function showView(newView, now = false) {
    view = newView;
    if (now) {
      render();
    } else if (!renderQueued) {
      renderQueued = true;
      requestAnimationFrame(render);
    }
  }

  // If the map changes size (window resized, phone rotated, map shown),
  // redraw so the view still fits.
  new ResizeObserver(() => showView(view)).observe(svg);

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
      showView(target, true);
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
      // We're already inside a screen refresh, so draw straight away.
      markMoving();
      showView(from.map((value, i) => value + (target[i] - value) * eased), true);
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);

    // Safety net. Browsers pause animations in tabs that aren't visible.
    // If that happens, jump straight to the target once the time is up,
    // so the map is never left stuck in the wrong place.
    setTimeout(() => {
      if (thisMove === moveNumber) showView(target, true);
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
  // 3. HOVER: highlighting the country you're pointing at
  // ===========================================================================

  // The countries that can be the answer in this round. null = all of them.
  // The rest are greyed out (see setPlayable).
  let playable = null;

  // Can this country be chosen? (false for the sea and greyed-out land)
  function canPick(code) {
    return Boolean(code) && (!playable || playable.has(code));
  }

  // Hover only happens on maps the player taps (games that gave an onPick).
  // A game can also switch it off, e.g. when the player is typing instead.
  let hoverEnabled = Boolean(onPick);
  let hoverCode = null; // the country currently highlighted

  // Highlights a country (or nothing, for null).
  function setHover(code) {
    if (code === hoverCode) return;
    if (hoverCode && rings[hoverCode]) rings[hoverCode].classList.remove('is-hovered');
    hoverCode = code;
    if (hoverCode && rings[hoverCode]) rings[hoverCode].classList.add('is-hovered');
    drawHover();
  }

  // Draws the highlighted country as a copy on top of the map, slightly
  // bigger, with a heavy ink outline. The real country is left untouched.
  function drawHover() {
    hoverLayer.replaceChildren();
    if (!hoverCode || !sizedForZoom) return;

    const shape = mapData.countries[hoverCode];
    const [x, y, width, height] = shape.box;
    const centreX = x + width / 2;
    const centreY = y + height / 2;

    // How much to grow it. Small countries grow a lot (up to 3 times) so
    // they become easy to see; big ones barely change.
    // onScreen = the country's size on screen right now, in pixels.
    const onScreen = Math.max(width, height) * sizedForZoom;
    const grow = onScreen < 120 ? Math.min(3, Math.max(1.08, 40 / onScreen)) : 1.02;
    // Scale around the country's centre, so it grows in place.
    const transform =
      `translate(${centreX} ${centreY}) scale(${grow}) translate(${-centreX} ${-centreY})`;

    // Keep the country's current colour (e.g. red if already guessed).
    const fill = getComputedStyle(shapes[hoverCode]).fill;

    hoverLayer.append(
      // A wide pale outline underneath makes it look lifted off the page.
      svgElement('path', { class: 'map-hover-edge', d: shape.d, transform }),
      svgElement('path', { class: 'map-hover-shape', d: shape.d, transform, style: `fill: ${fill}` })
    );
  }

  // ===========================================================================
  // 4. BY HAND: zooming, dragging, tapping and holding to aim
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

  // While the map is moving (dragged, pinched, scrolled or gliding), the
  // "is-moving" class is on the <svg>. map.css uses it to stop countries
  // reacting to the mouse, so no hover effects are worked out mid-drag, and
  // to hide the costly coastal halo. It comes off a moment after the last
  // movement.
  let stillTimer = null;
  function markMoving() {
    svg.classList.add('is-moving');
    clearTimeout(stillTimer);
    stillTimer = setTimeout(() => svg.classList.remove('is-moving'), 150);
  }

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
    markMoving();
    setHover(null); // the map is moving; the mouse is no longer "on" a country
  }

  svg.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault(); // zoom the map instead of scrolling the page
      takeOver();
      // deltaY is how far the wheel turned. Math.exp turns that into a
      // smooth multiplier: a small turn zooms a little, a big turn a lot.
      // Trackpads send many small events; showView bunches them into one
      // redraw per screen refresh.
      showView(zoomedView(Math.exp(event.deltaY * 0.0015), event.clientX, event.clientY));
    },
    { passive: false } // needed so preventDefault is allowed
  );

  // The fingers (or mouse button) currently down on the map: id -> position.
  const pointers = new Map();
  // Facts about the press in progress, used to tell a tap from a drag.
  let press = { travelled: 0, wasPinch: false };

  // HOLD TO AIM (touchscreens). Hold a finger still for AIM_DELAY and a
  // target appears AIM_OFFSET pixels above it, where your finger isn't
  // covering the map. Slide to move the target; let go to choose.
  const AIM_DELAY = 350; // milliseconds
  const AIM_OFFSET = 70; // pixels
  let aimTimer = null;
  let aiming = false;

  // Which country (if any) is drawn at a spot on the screen?
  function codeAt(screenX, screenY) {
    const element = document.elementFromPoint(screenX, screenY);
    return element?.closest?.('[data-code]')?.dataset.code ?? null;
  }

  // The country to choose for a tap at this spot. If the spot is a country
  // (even a greyed-out one) that's the answer. If it's sea, look a little
  // way around it: a tap just beside a small island counts as that island.
  function pickAt(screenX, screenY) {
    const direct = codeAt(screenX, screenY);
    if (direct) return direct;
    for (const distance of [6, 10, 14]) {
      for (let step = 0; step < 12; step++) {
        const angle = (step / 12) * 2 * Math.PI;
        const code = codeAt(
          screenX + Math.cos(angle) * distance,
          screenY + Math.sin(angle) * distance
        );
        if (canPick(code)) return code;
      }
    }
    return null;
  }

  // Tells the game what was picked at a spot on the screen.
  function pick(screenX, screenY) {
    // Countries ignore the pointer while the map is moving (see
    // markMoving). A tap means it has stopped, so switch them back on
    // before asking what was tapped.
    clearTimeout(stillTimer);
    svg.classList.remove('is-moving');
    onPick({ code: pickAt(screenX, screenY), point: screenToMap(screenX, screenY) });
  }

  // Moves the aiming target to sit above a finger at (x, y) and highlights
  // the country under it.
  function aimAt(x, y) {
    const box = svg.getBoundingClientRect();
    aimTarget.style.left = `${x - box.left}px`;
    aimTarget.style.top = `${y - AIM_OFFSET - box.top}px`;
    const code = pickAt(x, y - AIM_OFFSET);
    setHover(canPick(code) ? code : null);
  }

  function stopAiming() {
    clearTimeout(aimTimer);
    aimTimer = null;
    aiming = false;
    aimTarget.hidden = true;
  }

  svg.addEventListener('pointerdown', (event) => {
    if (pointers.size === 0) press = { travelled: 0, wasPinch: false };
    else press.wasPinch = true; // a second finger has joined
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    // "Capture" keeps the drag going even if the pointer leaves the map.
    svg.setPointerCapture(event.pointerId);

    // A single finger on a map you tap: start the hold-to-aim countdown.
    stopAiming();
    if (onPick && hoverEnabled && event.pointerType === 'touch' && pointers.size === 1) {
      aimTimer = setTimeout(() => {
        // Still one finger, and it hasn't moved: start aiming.
        if (pointers.size !== 1 || press.travelled >= TAP_WOBBLE) return;
        const finger = [...pointers.values()][0];
        aiming = true;
        aimTarget.hidden = false;
        aimAt(finger.x, finger.y);
      }, AIM_DELAY);
    }
  });

  svg.addEventListener('pointermove', (event) => {
    const before = pointers.get(event.pointerId);

    // No button or finger down: this is just the mouse moving over the map.
    // Highlight the country under it.
    if (!before) {
      if (hoverEnabled && event.pointerType !== 'touch') {
        const code = codeAt(event.clientX, event.clientY);
        setHover(canPick(code) ? code : null);
      }
      return;
    }

    const now = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, now);

    // Aiming: move the target, don't move the map.
    if (aiming) {
      aimAt(now.x, now.y);
      return;
    }

    press.travelled += Math.hypot(now.x - before.x, now.y - before.y);

    if (pointers.size === 1) {
      // ONE finger or the mouse. Ignore tiny wobbles, so a slightly shaky
      // tap doesn't nudge the map.
      if (press.travelled >= TAP_WOBBLE) {
        const units = unitsPerPixel();
        stopAiming(); // it's a drag, not a hold
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
      stopAiming();
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
  });

  svg.addEventListener('pointerup', (event) => {
    const wasTap =
      pointers.has(event.pointerId) &&
      pointers.size === 1 &&
      !press.wasPinch &&
      press.travelled < TAP_WOBBLE;
    const wasAiming = aiming;

    pointers.delete(event.pointerId);
    if (pointers.size === 0) svg.classList.remove('is-dragging');
    stopAiming();

    if (!onPick) return;
    if (wasAiming) {
      // Choose whatever is under the target, not under the finger.
      setHover(null);
      pick(event.clientX, event.clientY - AIM_OFFSET);
    } else if (wasTap) {
      pick(event.clientX, event.clientY);
    }
  });

  svg.addEventListener('pointercancel', (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size === 0) svg.classList.remove('is-dragging');
    stopAiming();
    setHover(null);
  });

  // The mouse has left the map: nothing is highlighted any more.
  svg.addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'touch') setHover(null);
  });

  // Stops a long press on a phone opening the "save image" menu.
  svg.addEventListener('contextmenu', (event) => {
    if (onPick) event.preventDefault();
  });

  // ===========================================================================
  // 5. MARKS: the arrow and the ring
  // ===========================================================================

  // What is currently drawn on top of the map (null = nothing).
  let arrow = null; // { from: [x, y], to: [x, y] }
  let ringCode = null; // the country with a ring round it

  // Redraws the marks. Called when they change or the zoom changes, so the
  // arrow and ring always stay the same size on screen.
  function drawMarks() {
    markLayer.replaceChildren();
    if (!arrow && !ringCode) return;
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
  // 6. CONTROLS: what a game can ask the map to do
  // ===========================================================================
  return {
    project,
    unproject,

    // Clears all colours and marks and shows the whole world.
    // blank = true hides the border lines, leaving plain land (see map.css).
    reset(blank = false) {
      svg.classList.toggle('is-blank', blank);
      for (const code of Object.keys(shapes)) this.setState(code, null);
      this.setPlayable(null);
      setHover(null);
      arrow = null;
      ringCode = null;
      drawMarks();
      moveNumber += 1; // stop any camera move from the last round
      userMoved = false;
      showView(wholeWorld, true);
    },

    // Colours a country. state is a word such as 'start', 'end', 'chain',
    // 'wrong' or 'right' (the full list and their colours are in map.css),
    // or null to clear it.
    setState(code, state) {
      for (const element of [shapes[code], rings[code]]) {
        if (!element) continue;
        if (state) element.dataset.state = state;
        else delete element.dataset.state;
      }
      // Move a coloured country to the front so its outline isn't covered
      // by its neighbours.
      if (state) world.insertBefore(shapes[code], ringLayer);
      // If it's the highlighted country, redraw the highlight in its new colour.
      if (code === hoverCode) drawHover();
    },

    // Greys out every country NOT in the list, to show it can't be the
    // answer this round. Greyed-out countries don't light up on hover and
    // lose their rings, but can still be tapped (the game decides what to
    // say). Pass null to make every country playable again.
    setPlayable(codes) {
      playable = codes ? new Set(codes) : null;
      for (const [code, shape] of Object.entries(shapes)) {
        const out = !canPick(code);
        shape.classList.toggle('is-out', out);
        rings[code]?.classList.toggle('is-out', out);
      }
      if (hoverCode && !canPick(hoverCode)) setHover(null);
    },

    // Turns the hover highlight and hold-to-aim on or off (for example, off
    // while the player is typing answers instead of tapping).
    setHoverEnabled(enabled) {
      hoverEnabled = enabled && Boolean(onPick);
      if (!hoverEnabled) setHover(null);
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
