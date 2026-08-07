# SKLC3 Live Logs Bridge (browser extension)

Prenáša živé logy pod `tms-multi-agent` (index `p-lct-k8s-*`) zo session
Kibany (`https://kibana.prod.alza.cz`) do appky Editor dopravníkovej siete
(`http://localhost:5173`), bez API kľúča a bez backend zmien — pozri
`docs/kibana-live-validation.md` v koreni repa pre kontext, prečo tento
prístup (Variant B) a nie priame ES pripojenie.

## Ako to funguje

- `kibana-fetcher.js` beží ako content script na `kibana.prod.alza.cz` a
  každé 3 sekundy volá `POST /api/console/proxy` (Kibana Dev Tools Console
  proxy) s presne tým `_search` dopytom, ktorý bol ručne overený v Console.
  Funguje len pokým je karta s Kibanou otvorená a je aktívna prihlásená
  session.
- `background.js` (service worker) je most: prijme dáta/chybu od
  kibana-fetcher a rozošle ich do všetkých otvorených kariet appky.
- `app-bridge.js` beží na `localhost:5173` a len preposiela prijaté dáta do
  stránky cez `window.postMessage` — appka (`src/index.html`) si ich sama
  vykreslí v paneli logov.

Nikam sa neposiela API kľúč ani credentials mimo prehliadača — celý tok ide
cez existujúcu Kibana session v prehliadači.

## Inštalácia (Chrome/Edge, rozbalené rozšírenie)

1. `chrome://extensions` (alebo `edge://extensions`).
2. Zapni **Developer mode** (prepínač vpravo hore).
3. **Load unpacked** → vyber priečinok `browser-extension/` z tohto repa.
4. Over, že v zozname rozšírení nie sú chyby manifestu.

## Použitie

1. Otvor a prihlás sa do `https://kibana.prod.alza.cz` (nechaj kartu
   otvorenú — poll beží, len kým je táto karta načítaná).
2. Otvor appku a otvor panel živých logov:
   - lokálne: `http://localhost:5173/` (spustenú cez `npm start` v koreni
     repa), alebo
   - **GitHub Codespaces**: otvor forwarded port 5173 v **skutočnej karte
     Chrome/Edge** (nie vo VS Code Simple Browser — tam extension nefunguje,
     lebo to nie je reálna karta prehliadača). URL má tvar
     `https://<názov-codespace>-5173.app.github.dev`; manifest má
     `host_permissions`/`content_scripts` už nastavené na wildcard
     `https://*.app.github.dev/*` (Chrome/Edge nepovoľujú wildcard zlepený s
     časťou labelu ako `*-5173.app.github.dev` — `Invalid host wildcard` pri
     načítaní), takže funguje pre ľubovoľný codespace/port bez úpravy po
     každom novom vytvorení. Over v Codespace →
     panel **Ports**, že port `5173` je forwardnutý (spustený `npm start`)
     a otvor jeho URL priamo v Chrome (tlačidlo "Open in Browser", nie
     "Preview").
3. Záznamy sa aktualizujú automaticky každé ~3s. Ak sa nič nezobrazí, pozri
   nižšie "Riešenie problémov".

## Zmena nastavení

Všetky konštanty sú priamo v zdrojových súboroch (žiadna options stránka —
jednoduchý interný nástroj):

- `kibana-fetcher.js` → `POLL_INTERVAL_MS` (default 3000).
- `manifest.json` + `background.js` (`APP_URL_PATTERNS`) → ak appka beží na
  inom porte/hostname než `localhost:5173`/`127.0.0.1:5173`, uprav
  `host_permissions` v `manifest.json` aj `APP_URL_PATTERNS` v
  `background.js` a znovu načítaj rozšírenie (**Reload** v
  `chrome://extensions`).

Po akejkoľvek zmene zdrojového súboru treba rozšírenie ručne **Reload**-núť.

## Riešenie problémov

- **Panel v appke ukazuje "rozšírenie nenájdené"** — over, že karta s
  Kibanou je otvorená, prihlásená, a že rozšírenie je zapnuté (nie sivé v
  `chrome://extensions`).
- **Panel ukazuje "Kibana session nie je aktívna"** — prihlás sa znova do
  Kibany v tej istej karte.
- **Panel ukazuje "Dev Tools Console proxy nie je dostupný"** — účet nemá
  prístup k Kibana Dev Tools; over v Kibana Security, či rola má povolený
  prístup ku Console appke (`/api/console/proxy`).
- **Žiadna chyba, ale žiadne dáta** — otvor DevTools na karte s Kibanou
  (Console/Network) a skontroluj, či `kibana-fetcher.js` beží a aký status
  vracia `/api/console/proxy` požiadavka.

## Známe obmedzenia

- Neoficiálny internal API (`/api/console/proxy`) — Elastic ho môže
  kedykoľvek zmeniť bez upozornenia.
- Funguje len pokým je karta s Kibanou otvorená a session aktívna — nie je
  to nezávislý/serverový zdroj dát (na to je Variant A, pozri
  `docs/elasticsearch-api-key-p-lct-k8s.md`).
- Zdieľané/globálne pre appku — ak je otvorených viac kariet appky, všetky
  dostanú rovnaký stream.
