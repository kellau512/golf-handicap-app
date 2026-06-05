# Golf Handicap App

A local web app for U.S. golfers to calculate a course-specific target score from a Handicap Index.

## Features

- Manual Handicap Index entry
- Daily local all-state course index for fast browsing
- Persistent live-search cache for courses missing from the state index
- Tee and scorecard detail caching after a course is selected
- Live course search through OpenGolfAPI when the local index has no match
- Fallback U.S. sample courses for offline/local testing
- Course Handicap calculation
- Target gross score calculation
- Hole-by-hole strokes received using each hole's handicap allocation
- Expandable data freshness panel for daily index and live-cache status
- GHIN integration status placeholder for future approved API access

## Run Locally

```bash
node server.js
```

Then open [http://localhost:3000](http://localhost:3000).

No package install is required for the current prototype because it uses Node's built-in HTTP server and browser-native JavaScript. If npm is available on your machine, `npm start` runs the same command.

## Test

```bash
node --test
```

The tests cover the shared handicap calculator, stroke allocation, scorecard totals, course normalization, alphabetical sorting, and cache key behavior.

## Course Data

The app stores a daily all-state course index in `data/course-index.json`. That index uses one OpenGolfAPI state-list request per state, so a full refresh is about 50 API calls instead of hydrating every course up front.

The server refreshes the index in the background on startup and then once every 24 hours. You can also run a manual refresh:

```bash
npm run refresh:courses
```

Selected course tee and scorecard details are cached separately in `data/course-detail-*.json` after they are loaded. Those detail files are reused for 24 hours.

Courses discovered through live search are stored in `data/live-search-cache.json`, so missing-index courses like Redwood Canyon only need to be discovered once. The server also warms a capped number of recent course-detail files on startup and then once per day. The default cap is 20 courses and can be adjusted with `DETAIL_WARM_LIMIT`.

```bash
npm run warm:details
```

## GHIN Integration Note

Manual Handicap Index entry is the MVP path. GHIN integrations exist for approved systems, but GHIN does not currently publish a broadly available public developer API for independent apps. The app includes a placeholder API endpoint so official GHIN sync can be added once approved access is available.
