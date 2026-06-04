# Golf Handicap App

A local web app for U.S. golfers to calculate a course-specific target score from a Handicap Index.

## Features

- Manual Handicap Index entry
- Daily local course snapshot for fast California browsing
- Live course search through OpenGolfAPI when the local snapshot has no match
- Fallback U.S. sample courses for offline/local testing
- Course Handicap calculation
- Target gross score calculation
- Hole-by-hole strokes received using each hole's handicap allocation
- GHIN integration status placeholder for future approved API access

## Run Locally

```bash
node server.js
```

Then open [http://localhost:3000](http://localhost:3000).

No package install is required for the current prototype because it uses Node's built-in HTTP server and browser-native JavaScript. If npm is available on your machine, `npm start` runs the same command.

## Course Data

The app stores generated course snapshots in `data/course-snapshot-*.json`. A fresh snapshot is reused for 24 hours. If an older snapshot exists, the app serves it immediately and refreshes the data in the background; if no snapshot exists yet, the first browse request builds one from OpenGolfAPI.

## GHIN Integration Note

Manual Handicap Index entry is the MVP path. GHIN integrations exist for approved systems, but GHIN does not currently publish a broadly available public developer API for independent apps. The app includes a placeholder API endpoint so official GHIN sync can be added once approved access is available.
