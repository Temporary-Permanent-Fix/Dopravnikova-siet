# Changelog

Formát vychází z [Keep a Changelog](https://keepachangelog.com/), verze podle [Semantic Versioning](https://semver.org/) (MAJOR.MINOR.PATCH — pravidlo bumpu viz `AGENTS.md`).

## [2.1.3] - 2026-08-12

- Přepracován vizuální styl aplikace na tmavý „SKLC3" design (zelená
  identita, tmavé panely) podle sdíleného `sklc3-theme.css` — nahrazeny
  hodnoty designových tokenů v `:root` (`--bg`, `--surface`, `--text`,
  `--border`, `--accent`, stíny) a opraveny desítky natvrdo zapsaných
  světlých barev, které by jinak zůstaly nekonzistentní (chybové bannery,
  preflight chipy, stavy live-logů, focus ring vyhledávání, tlačítko
  „Rovnoměrné/Optimalizovat" a tooltip hrany, které dřív používaly
  `var(--text)` jako pozadí — po přepnutí `--text` na bílou by tak zůstaly
  neviditelné bílé-na-bílém). Plátno se sítí uzlů (canvas rendering) a
  uvítací "sud" animace s Alza brandingem zůstávají beze změny —
  retheme se týká jen UI chromu (`src/index.html`).

## [2.1.2] - 2026-08-11

- Oprava: panel „🌐 Kibana“ (a s ním aj natívny embedded Kibana
  `WebContentsView`, ktorého bounds sa počítajú z rozmerov tohto DOM panelu)
  bol prakticky neviditeľný — `.sim-panel` je flex kontajner v smere `row`
  a `.kibana-view-panel` nemal explicitnú šírku, takže sa ako prázdny flex
  item zbalil na nulovú šírku. Operátor sa tak nikdy nemohol prihlásiť do
  vstavanej Kibany, čo sa navonok prejavovalo ako trvalá chyba „Kibana
  session nie je aktívna alebo chýbajú práva“ v paneli Live logs. Pridané
  `width: 100%` do `.kibana-view-panel` (`src/index.html`).
- Vstavaný Kibana `WebContentsView` teraz sleduje stav načítania
  (`electron/kibana-view-load.mjs`) — pri zlyhaní (napr. VPN/DNS ešte nie je
  pripravené pri štarte appky) automaticky skúša znovu (~2s/5s/15s) a panel
  zobrazí „Kibana sa nepodarilo načítať“ s tlačidlom „↻ Znovu načítať“
  namiesto trvalo prázdnej/nefunkčnej plochy. Live Logs panel teraz ponúka
  tlačidlo „Otvoriť Kibana kartu“ aj pri sieťovej chybe, nielen pri auth
  chybe. SSO/SAML pop-up prihlásenie zo same-origin Kibana adresy ostáva vo
  vstavanej `persist:kibana` session namiesto presmerovania do externého OS
  prehliadača (`electron/main.mjs`, `electron/preload.cjs`).

## [2.1.1] - 2026-08-11

- Odstránený server-side `LIVE_DATA_MODE=elasticsearch` režim a s ním
  `ELASTICSEARCH_API_KEY`/`ELASTICSEARCH_URL`/`ELASTICSEARCH_INDEX` a celé
  HTTP API `/api/live/config`, `/api/live/query`, `/api/live/snapshot`,
  `/api/live/stream` zo `server/index.mjs` — appka ho už nevolala (živé dáta
  idú výhradne cez operátorovu Kibana session v Electron karte alebo
  `browser-extension/`, nikdy cez API kľúč), tento kód bol nefunkčný aj
  lokálne (`ELASTICSEARCH_URL` je interná k8s `.svc` adresa) a nikdy sa v
  praxi nepoužíval. `server/index.mjs` teraz servíruje už len statické
  súbory, `/api/health` a `/api/version`.
- Odstránený nepoužívaný `src/kibana-rison.mjs` (rison decoder pre UI
  tlačidlo "🔗 Kibana link", ktoré bolo zo `src/index.html` odstránené už
  skôr) a s ním súvisiace testy/fixtures.
- Odstránená dokumentácia, ktorá popisovala len vyššie uvedený mŕtvy kód
  (`docs/elasticsearch-api-key-p-lct-k8s.md`,
  `docs/elasticsearch-access-checklist.md`,
  `docs/kibana-live-validation.md`) a stará necommitnutá lokálna
  `server/.env` s reálnym (teraz zrušeným) Elasticsearch API kľúčom bola
  vyčistená na minimum (`PORT`).
- `README-local-setup.md` prepísaný — pôvodne opisoval len starý web-server
  postup a neexistujúci "Variant A" (priame ES pripojenie); teraz opisuje aj
  `npm run electron:dev` ako odporúčaný spôsob spustenia.
- Odstránené zvyšky z Tauri éry appky (nahradenej Electronom, pozri `[2.0.0]`
  nižšie): `src/tauri-integration.js` (a jeho `<script>` tag v
  `src/index.html`, `window.__TAURI__` appka už nepoužíva), `_recovered/`
  a `RECOVERY-README.md`. `README.md` prepísaný pre aktuálnu Electron
  architektúru.

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
