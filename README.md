# Editor dopravníkové sítě

Desktopový nástroj (Electron) na editáciu layoutu dopravníkovej / triediacej
siete — uzly a hrany naprieč podlažiami skladu, s optimalizáciou cez LP solver
a živým napojením na Kibana logy cez vstavanú kartu.

## Štruktúra

    electron/                 desktop shell (main proces, Kibana poller, preload)
    server/                   Node HTTP server — servíruje src/ + /api/health, /api/version
    src/                      front-end
      index.html              celá appka (HTML + CSS + JS v jednom súbore)
      assets/                 logo, fonty (IBM Plex + Tabler Icons, vendorované z npm)
      highs/build/            HiGHS wasm (vendorované z npm, viď README vnútri)
      live-events.mjs         normalizácia Kibana eventov na agent/direction/edgeId
    browser-extension/        fallback živých logov pre web/Codespaces nasadenie bez Electronu
    data/
      data.json               obnovený dataset CZLC4 (len historická referencia)
      sklc3-telemetry-mapping.md  zdroj pravdy pre Kibana agent:direction → edgeId mapovanie
    src/sklc3.json            aktívny lokálny layout SKLC3
    windows-installer/        starší web-server-only Windows inštalátor (fallback bez Electronu)

## Solver

- Primárny: **HiGHS** (WASM, beží vo Web Workeri z inline blobu) — súbory v `src/highs/build/`.
- Fallback: **glpk.js** (GLPK) — načítava sa z CDN `https://esm.sh/glpk.js@4.0.2`.

## Dáta

Appka si stav ukladá do `localStorage`. Tlačidlo **Načíst SKLC3** načíta lokálny
`src/sklc3.json` (aktívny layout) a nevyžaduje internet ani GitHub token.
`data/data.json` obsahuje pôvodný CZLC4 dataset len ako historickú referenciu.

## Živé dáta

Appka nemá žiadny server-side prístup do Elasticsearch a žiadny API kľúč —
živé Kibana logy idú vždy cez operátorovu vlastnú prihlásenú Kibana session:
vstavaná karta v Electrone (`electron/`), alebo `browser-extension/` pri
nasadení bez Electronu (napr. GitHub Codespaces). Pozri
`README-local-setup.md` pre spustenie a `browser-extension/README.md` pre
detaily živých logov.

## Ako rozbehať

```bash
npm install
npm run electron:dev   # desktop appka so vstavanou Kibana kartou
# alebo
npm start               # web server bez Electronu (http://127.0.0.1:5173)
```

Windows `.exe` inštalátor (electron-builder, NSIS): `npm run electron:build`
→ `dist-electron/`. Podrobnosti vrátane predpokladov a rozšírenia pre živé
logy: `README-local-setup.md`.

## Testy

```bash
npm test
```

## Verziovanie

Pozri `AGENTS.md` — verzia appky žije v `package.json` (`version`), je
servírovaná na `/api/version` a zobrazená ako badge v hlavičke appky.
