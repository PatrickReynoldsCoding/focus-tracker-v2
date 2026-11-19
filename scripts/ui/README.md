# Browser checks

Playwright scripts that click through the app against a local server (`npm run build && npx wrangler dev --port 8787 --persist-to /tmp/ft-ui`). `seed.mjs` fills it with sample data; `part1` (Notes tab), `part2` (themes, all four at phone and desktop width), `part3` (Back and swipe), `plan` (Plan my week, light and E-ink at 390 and 1280 px), `appearance`, `overflow`. Screenshots go to `$FT_SHOTS` (default /tmp/ft-ui-shots). `../ui-smoke.mjs` is the quick check run before every release.
