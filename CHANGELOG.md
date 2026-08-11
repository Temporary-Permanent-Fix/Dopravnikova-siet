# Changelog

Formát vychází z [Keep a Changelog](https://keepachangelog.com/), verze podle [Semantic Versioning](https://semver.org/) (MAJOR.MINOR.PATCH — pravidlo bumpu viz `AGENTS.md`).

## [2.1.0] - 2026-08-10

- Pridané `electron-builder` balenie (`npm run electron:build`) — produkuje
  skutočný Windows NSIS inštalátor (`dist-electron/Dopravníková sieť Setup
  *.exe`), ktorý nevyžaduje Node.js na cieľovom stroji. Nahrádza pre desktop
  build starý `windows-installer/` postup (ten zostáva nedotknutý ako
  fallback pre ne-Electron nasadenie). `.env` súbory (`server/.env`,
  `electron/.env`) sú z balíčka explicitne vylúčené — overené, že v
  zabalenom `app.asar` nie sú žiadne credentials.

## [2.0.0] - 2026-08-10

- Pridaná Electron desktop shell (`electron/`) so vstavanou Kibana kartou
  (🌐 Kibana v spodnom sim paneli) — operátor sa prihlási priamo v appke,
  appka na pozadí z tej istej session dopytuje dáta cez `executeJavaScript`
  (rovnaká technika ako predtým content script), bez nutnosti externej karty
  a browser extension. Spustenie: `npm run electron:dev`.
- `browser-extension/` ponechané bezo zmeny ako fallback pre web/Codespaces
  nasadenie appky bez Electronu (`npm start`).

## [1.0.0] - 2026-08-10

- Zavedení verziování aplikace (`package.json` `version`, `/api/version`, badge v hlavičce).
- Možnost skrýt jednotlivá tlačítka spodního sim panelu (živého pohybu/logů/exportů).
- Oprava: přidání uzlu z palety drag-and-drop nyní spolehlivě funguje i během live módu.
