# Golf Handicap App

A local web app for U.S. golfers to calculate a course-specific target score from a Handicap Index.

## Features

- Manual Handicap Index entry
- Simple local user accounts
- Saved Handicap Index per account
- Live course lookup through OpenGolfAPI when available
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

## GHIN Integration Note

Manual Handicap Index entry is the MVP path. GHIN integrations exist for approved systems, but GHIN does not currently publish a broadly available public developer API for independent apps. The app includes a placeholder API endpoint so official GHIN sync can be added once approved access is available.
