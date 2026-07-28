# Obnova zdrojáku — Editor dopravníkové sítě 0.3.2-BETA

Zdroják vytiahnutý z `editor-dopravniku-0.3.2-BETA.exe` (Tauri 2.11.2).
Front-end assety boli v binárke embednuté a brotli-komprimované; dekomprimované späť
(Node má vstavaný brotli dekodér — našli sa komprimované bloby v `.exe` a rozbalili).

## Plne obnovené (tvoj kód, čitateľný, NEminifikovaný)
- `src/index.html` — celá appka; 206 funkcií, ~950 komentárov, pôvodné formátovanie zachované.
- `data/data.json` — dataset siete: 3 podlažia (CZLC4 3./2./1. NP), 372 nodes, 447 edges.
- `src/assets/alza_cz.png` — logo (raw).

## Čiastočne
- `_recovered/tauri-integration.partial.js` — Tauri IPC glue, obnovený len sčasti.
  Netreba riešiť: s `withGlobalTauri: true` funguje aj bez neho.

## Nedá sa obnoviť z .exe
- Rust backend (`src-tauri/*.rs`) — skompilovaný, nedekompilovateľný na použiteľný zdroj.
- `tauri.conf.json`, `Cargo.toml`, `package.json` — neembednuté (rekonštruovateľné).

## Third-party (doplniť zvlášť)
- Fonty IBM Plex + Tabler Icons → `src/assets/fonts/`
- HiGHS WASM → `src/highs/build/`
- glpk.js → CDN, netreba lokálne.
