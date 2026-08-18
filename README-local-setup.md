# Lokálne spustenie mimo Codespace

Návod na spustenie appky **Live Dopravníky / SKLC3** na vlastnom počítači
(Windows/macOS/Linux), bez závislosti na GitHub Codespace.

## 0. Rýchly prehľad

| Čo | Funguje lokálne? |
| --- | --- |
| Appka (editor siete, mock dáta) | ✅ áno, vždy |
| Electron desktop shell so vstavanou Kibana kartou | ✅ áno, **ak** máš sieťový prístup (VPN/firemná sieť) na `kibana.prod.alza.cz` a si tam prihlásený |
| `browser-extension/` — live logy vo web/Codespaces nasadení bez Electronu | ✅ áno, za rovnakej sieťovej podmienky ako vyššie |

Appka nemá žiadny server-side prístup do Elasticsearch a žiadny API kľúč —
živé dáta idú vždy cez operátorovu vlastnú prihlásenú Kibana session
(embedded karta v Electrone, alebo `browser-extension/` mimo Electronu).

## 1. Predpoklady

- **Node.js ≥ 20.11** (kód používa `import.meta.dirname`, ktoré staršie
  verzie nemajú). Odporúčaná je aktuálna LTS verzia (22.x) —
  stiahni z [nodejs.org](https://nodejs.org) alebo cez `winget install OpenJS.NodeJS.LTS` (Windows) / `brew install node` (macOS).
  Over po inštalácii: `node --version`.
- **Git** (pre `git clone`).
- Pre non-Electron web nasadenie: **Chrome alebo Edge** — pre rozšírenie
  SKLC3 Live Logs Bridge.

> Windows: hotový inštalátor (electron-builder NSIS `.exe`, nevyžaduje
> Node.js na cieľovom stroji) sa vyrába cez `npm run electron:build` —
> pozri `dist-electron/`. Postup nižšie je pre spustenie zo zdrojového kódu
> (Windows/macOS/Linux).

## 2. Stiahnutie repozitára

```bash
git clone https://github.com/Temporary-Permanent-Fix/Dopravnikova-siet.git
cd Dopravnikova-siet
```

Repozitár je **privátny** — na `git clone` musíš byť prihlásený GitHub
účtom, ktorý má naň prístup (`gh auth login`, alebo SSH kľúč).

## 3. Inštalácia a spustenie

```bash
npm install
```

**Desktop (Electron, odporúčané)** — vstavaná Kibana karta, žiadna
extension netreba:

```bash
npm run electron:dev
```

**Web server bez Electronu** (napr. pre `browser-extension/` nasadenie):

```bash
npm start
```

Server naštartuje na `http://127.0.0.1:5173`. Konzola vypíše presnú
adresu. Appku otvor v prehliadači na tejto URL.

Ak by si neskôr chcel(a) upraviť port/host, skopíruj
`server/.env.example` na `server/.env` a uprav `PORT`/`HOST` — tento súbor
je zámerne v `.gitignore`, takže sa nikdy neposiela do repozitára.

## 4. Inštalácia rozšírenia SKLC3 Live Logs Bridge (bez Electronu)

Potrebné iba ak appku spúšťaš cez `npm start` (bez Electronu) a chceš živé
logy z Kibany:

1. Otvor `chrome://extensions` (alebo `edge://extensions`) v Chrome/Edge.
2. Zapni **Režim vývojára / Developer mode** (prepínač vpravo hore).
3. **Načítať rozbalené / Load unpacked** → vyber priečinok
   `browser-extension/` z naklonovaného repozitára.
4. Over, že sa rozšírenie **SKLC3 Live Logs Bridge** zobrazí bez chýb.

Rozšírenie je už nastavené tak, aby fungovalo aj lokálne, aj v Codespace,
bez úprav — `manifest.json` (`host_permissions`/`content_scripts`) aj
`background.js` (`APP_URL_PATTERNS`) obsahujú súčasne:

```
http://localhost:5173/*
http://127.0.0.1:5173/*
https://*-5173.app.github.dev/*   (len pre Codespace, lokálne sa nepoužije)
```

Podrobnosti a riešenie problémov: `browser-extension/README.md`.

## 5. Použitie live logov lokálne

1. Otvor a prihlás sa do `https://kibana.prod.alza.cz` — funguje to iba
   ak má tvoj počítač sieťový prístup na túto internú firemnú doménu (VPN
   alebo firemná sieť; z bežného domáceho internetu bez VPN sa tam
   nedostaneš).
   - **Electron**: prihlás sa priamo vo vstavanej Kibana karte v appke
     (🌐 Kibana v spodnom paneli).
   - **Web bez Electronu**: nechaj kartu s Kibanou otvorenú v prehliadači
     (poll na pozadí beží len kým je karta načítaná).
2. Panel **📋 Live logs** v appke sa aktualizuje automaticky cez existujúcu
   Kibana session (žiadny API kľúč sa nikam neposiela).
