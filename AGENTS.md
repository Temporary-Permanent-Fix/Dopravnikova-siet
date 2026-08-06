# AGENTS.md

## Project overview
This repository contains a desktop-oriented editor for a conveyor/sorting network, with a mostly static frontend in `src/index.html` and a small Node-based server layer in `server/` for live telemetry processing and mapping.

## Working conventions
- Keep changes small, targeted, and compatible with the existing architecture.
- Preserve the current structure of the frontend: the app is largely self-contained in `src/index.html` with supporting assets under `src/assets/` and `src/highs/build/`.
- Prefer ESM modules and existing patterns in `server/` over introducing new frameworks or dependencies.
- When changing telemetry or mapping behavior, update the relevant tests and fixtures in `server/`.
- Avoid editing generated or third-party assets unless the task explicitly requires it.

## Key commands
- Run the test suite: `npm test`
- Start the server locally: `npm run dev` or `npm start`

## Important files
- `src/index.html` — main frontend UI and layout logic.
- `server/index.mjs` — server entry point and snapshot generation.
- `server/live-events.mjs` — normalization and live-event processing.
- `server/*.test.mjs` — regression tests for mapping and event behavior.
- `src/sklc3.json` and `src/sklc3-telemetry.json` — runtime layout and telemetry data.

## Domain notes
- The telemetry pipeline is centered around agent/direction/edgeId semantics.
- Passive-segment traversal and mapping decisions should remain consistent with the existing logic.
- Documentation in `docs/` and `data/` is part of the project context; prefer keeping it aligned with code changes.
