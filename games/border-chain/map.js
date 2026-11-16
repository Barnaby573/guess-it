// games/border-chain/map.js
//
// Draws the world map and moves the "camera" around it.
//
// The map is an SVG: a picture made of shapes described in text, which
// stays sharp at any zoom level. Zooming works by changing the SVG's
// "viewBox", which says which rectangle of the map is currently on screen.

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

// Does this person's device ask for reduced motion? If so the camera jumps
// instead of gliding.
const reducedMotion = window.matchMedia(
  '(prefers-reduced-motion: reduce)'
).matches;

// Creates an SVG element (these need a special function, unlike HTML ones).
function svgElement(name, attributes) {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
  return element;
}

// Sets up the map inside the given <svg> element and returns a few
// functions the game uses to control it.
//
// mapData is the contents of data/map.json.
export function createMap(svg, mapData) {
  const wholeWorld = [0, 0, mapData.width, mapData.height];

  // The rectangle currently on screen: [x, y, width, height].
  let view = wholeWorld;
  // Goes up by one each time a new camera move starts, so an older move
  // that is still running knows to stop.
  let moveNumber = 0;

  // ---- Draw everything once -------------------------------------------------
  svg.innerHTML = '';

  // Land that isn't one of our 195 countries (Greenland, for example).
  svg.append(svgElement('path', { class: 'map-background', d: mapData.background }));

  const shapes = {}; // code -> the country's <path>
  const dots = {}; // code -> a <circle>, only for tiny countries

  for (const [code, shape] of Object.entries(mapData.countries)) {
    shapes[code] = svgElement('path', { class: 'map-country', d: shape.d });
    svg.append(shapes[code]);
  }

  // Tiny countries (Monaco, Andorra...) get a dot so they can be seen.
  // Dots are added last so they sit on top of the shapes.
  const dotLayer = svgElement('g', {});
  for (const [code, shape] of Object.entries(mapData.countries)) {
    if (!shape.tiny) continue;
    const [x, y, width, height] = shape.box;
    dots[code] = svgElement('circle', {
      class: 'map-dot',
      cx: x + width / 2,
      cy: y + height / 2,
    });
    dotLayer.append(dots[code]);
  }
  svg.append(dotLayer);

  // ---- Camera -----------------------------------------------------------------

  // Puts a rectangle of the map on screen.
  function showView(newView) {
    view = newView;
    svg.setAttribute('viewBox', newView.join(' '));
    // Keep dots the same size on screen however far we're zoomed in.
    const radius = newView[2] * 0.008;
    for (const dot of Object.values(dots)) dot.setAttribute('r', radius);
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
  }

  // ---- What the game can ask the map to do -------------------------------------
  return {
    // Clears all colours and shows the whole world.
    // blank = true hides every country until it is given a state.
    reset(blank) {
      svg.classList.toggle('is-blank', blank);
      for (const code of Object.keys(shapes)) this.setState(code, null);
      moveNumber += 1; // stop any camera move from the last round
      showView(wholeWorld);
    },

    // Colours a country. state is one of 'start', 'end', 'chain', 'current',
    // 'wrong', 'loose', or null to clear it. The colours are in game.css.
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

    // Moves the camera so all the given countries are on screen.
    focusOn(codes, milliseconds = 700) {
      glideTo(frame(boxAround(codes)), milliseconds);
    },
  };
}
