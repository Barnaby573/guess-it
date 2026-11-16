// shared/header.js
//
// Adds the "Guess It" header to the top of a page. Every page calls this,
// so the header only has to be written (and changed) in one place.

// homeHref = the link back to the home page, relative to the current page.
// The home page passes './' and a game page passes '../../'.
export function renderHeader(homeHref) {
  const header = document.createElement('header');
  header.className = 'site-header';

  const logo = document.createElement('a');
  logo.className = 'logo';
  logo.href = homeHref;
  logo.innerHTML = 'Guess <span>It</span>';

  header.append(logo);

  // "prepend" puts the header at the very top of the page.
  document.body.prepend(header);
}
