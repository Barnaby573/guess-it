// shared/analytics.js
//
// Turns on Vercel Web Analytics: privacy-friendly visitor counts (which
// pages are visited, from which countries and devices). It uses no
// cookies and doesn't track individual people.
//
// This file is imported by shared/header.js, and every page on the site
// loads the header, so analytics runs on every page automatically. A new
// game gets it for free as long as it calls renderHeader().
//
// The numbers appear in the Vercel dashboard, under the project's
// "Analytics" tab. Web Analytics has to be switched on there once.

import { inject } from '@vercel/analytics';

inject({
  // While developing on your own computer ("npm run dev"), visits are only
  // printed in the browser console, not counted. On the live site
  // ("npm run build"), they are sent to Vercel.
  mode: import.meta.env.DEV ? 'development' : 'production',
});
