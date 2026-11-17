// Vite configuration.
//
// Vite is the tool that runs the site while we develop ("npm run dev")
// and bundles it into plain static files for deployment ("npm run build").
//
// By default Vite only knows about the top-level index.html. Because our
// site has more than one page (the home page + one page per game), we list
// every page here so they all end up in the final build.

import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  // Use relative links in the built site. This means it works whether it is
  // hosted at the top of a domain (Vercel) or in a sub-folder (GitHub Pages).
  base: './',
  build: {
    rollupOptions: {
      input: {
        // Home page
        home: resolve(import.meta.dirname, 'index.html'),
        // Games - add a new line here each time a game is added
        higherLower: resolve(import.meta.dirname, 'games/higher-lower/index.html'),
        borderChain: resolve(import.meta.dirname, 'games/border-chain/index.html'),
        capitalDrop: resolve(import.meta.dirname, 'games/capital-drop/index.html'),
        learnCountries: resolve(import.meta.dirname, 'games/learn-countries/index.html'),
      },
    },
  },
});
