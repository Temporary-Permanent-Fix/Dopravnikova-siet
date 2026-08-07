# Lokálne spustenie mimo Codespace

Návod na spustenie appky **Dopravníková sieť / SKLC3** na vlastnom počítači
(Windows/macOS/Linux), bez závislosti na GitHub Codespace, vrátane
rozšírenia **SKLC3 Live Logs Bridge** (Variant B).

## 0. Rýchly prehľad

| Čo | Funguje lokálne? |
| --- | --- |
| Appka (editor siete, mock dáta) | ✅ áno, vždy |
| Variant B — live logy cez `browser-extension/` | ✅ áno, **ak** máš sieťový prístup (VPN/firemná sieť) na `kibana.prod.alza.cz` a si tam prihlásený |
| Variant A — priame pripojenie appky na Elasticsearch (`server/.env`, `LIVE_DATA_MODE=elasticsearch`) | ❌ nie, z domáceho PC nikdy — pozri nižšie |

### Prečo Variant A nepôjde ani lokálne

`ELASTICSEARCH_URL` v `server/.env` (pozri `server/.env.example`) je tvaru
`http://eck-pdc1k8sobs-logging-es-http.infra-ecklogging-prd-obs.svc:9200/`
— `*.svc:9200` je **interný Kubernetes service DNS názov**, ktorý existuje
iba vnútri firemného k8s clustra. Nie je to verejná adresa a nepomôže ani
VPN — mimo clustra (Codespace aj domáci PC rovnako) je nedosiahnuteľná.
Server v `LIVE_DATA_MODE=elasticsearch` preto lokálne vždy skončí chybou
pripojenia. Detaily: `docs/kibana-live-validation.md`.

Appka funguje bez toho úplne normálne — buď v **mock režime** (predvolené,
demo dáta), alebo cez **Variant B**, ktorý ide cez tvoju bežnú prihlásenú
Kibana session v prehliadači, nie cez Elasticsearch priamo.

## 1. Predpoklady

- **Node.js ≥ 20.11** (kód používa `import.meta.dirname`, ktoré staršie
  verzie nemajú). Odporúčaná je aktuálna LTS verzia (22.x) —
  stiahni z [nodejs.org](https://nodejs.org) alebo cez `winget install OpenJS.NodeJS.LTS` (Windows) / `brew install node` (macOS).
  Over po inštalácii: `node --version`.
- **Git** (pre `git clone`) — nie je nutný, ak použiješ ZIP.
- **Chrome alebo Edge** — pre rozšírenie SKLC3 Live Logs Bridge (Variant B).
- Žiadne ďalšie závislosti — `package.json` nemá žiadne npm balíčky,
  `npm install` len over prostredie.

> Windows: ak nechceš riešiť Node.js/git ručne, existuje aj hotový
> inštalátor — pozri `windows-installer/README.md` (`.exe` alebo `.bat`
> skripty, doinštalujú Node.js za teba). Postup nižšie je univerzálny
> (Windows/macOS/Linux) a dáva ti aj zdrojový kód na úpravy.

## 2. Stiahnutie repozitára

Repozitár `Temporary-Permanent-Fix/Dopravnikova-siet` na GitHube je
**privátny** — na `git clone` aj na tlačidlo "Code → Download ZIP" musíš
byť prihlásený GitHub účtom, ktorý má naň prístup.

**Možnosť A — git clone:**

```bash
git clone https://github.com/Temporary-Permanent-Fix/Dopravnikova-siet.git
cd Dopravnikova-siet
```

Ak `git clone` pýta prihlásenie, over že máš nastavenú GitHub autentifikáciu
(`gh auth login`, alebo SSH kľúč a URL `git@github.com:Temporary-Permanent-Fix/Dopravnikova-siet.git`).

**Možnosť B — Download ZIP:** na stránke repozitára na GitHube
**Code → Download ZIP**, rozbaľ lokálne.

**Možnosť C — ZIP pripravený v tomto prostredí:** v koreni repozitára v
tomto Codespace bol pripravený `dopravnikova-siet-local.zip` s presne tým
stavom súborov, aký je momentálne vo working directory (vrátane
`browser-extension/` a rozpracovaných zmien, ktoré ešte nie sú
commitnuté/pushnuté na GitHub — pozri poznámku nižšie). Stiahni si ho cez
VS Code Explorer (pravý klik → **Download**).

> **Dôležité:** `browser-extension/` a niektoré ďalšie súbory sú v tomto
> Codespace momentálne **necommitnuté** (nie sú ešte na GitHube). Kým
> zostanú necommitnuté, možnosti A a B vyššie ich nebudú obsahovať — funguje
> na ne len možnosť C (lokálny ZIP). Ak chceš, aby aj `git clone`/"Download
> ZIP" z GitHubu obsahovali `browser-extension/`, treba tieto zmeny najprv
> commitnúť a pushnúť (spýtaj sa ma, rád to spravím).

## 3. Inštalácia a spustenie servera

V koreni stiahnutého/naklonovaného repozitára:

```bash
npm install
npm start
```

Server naštartuje v **mock režime** (žiadne credentials netreba) na
`http://127.0.0.1:5173`. Konzola vypíše presnú adresu. Appku otvor v
prehliadači na tejto URL.

Ak by si neskôr chcel(a) upraviť port/host, skopíruj
`server/.env.example` na `server/.env` a uprav `PORT`/`HOST` — tento súbor
je zámerne v `.gitignore`, takže sa nikdy neposiela do repozitára.

## 4. Inštalácia rozšírenia SKLC3 Live Logs Bridge (Variant B)

1. Otvor `chrome://extensions` (alebo `edge://extensions`) v Chrome/Edge.
2. Zapni **Režim vývojára / Developer mode** (prepínač vpravo hore).
3. **Načítať rozbalené / Load unpacked** → vyber priečinok
   `browser-extension/` z naklonovaného/rozbaleného repozitára.
4. Over, že sa rozšírenie **SKLC3 Live Logs Bridge** zobrazí bez chýb.

Rozšírenie je už nastavené tak, aby fungovalo aj lokálne, aj v Codespace,
bez úprav — `manifest.json` (`host_permissions`/`content_scripts`) aj
`background.js` (`APP_URL_PATTERNS`) obsahujú súčasne:

```
http://localhost:5173/*
http://127.0.0.1:5173/*
https://*-5173.app.github.dev/*   (len pre Codespace, lokálne sa nepoužije)
```

Takže netreba nič meniť pri prechode z Codespace na lokálny beh — funguje
to na `http://localhost:5173/` presne tak isto.

## 5. Použitie Variant B lokálne

1. Otvor a prihlás sa do `https://kibana.prod.alza.cz` v novej karte —
   funguje to iba ak má tvoj domáci počítač sieťový prístup na túto
   internú firemnú doménu (VPN alebo firemná sieť; z bežného domáceho
   internetu bez VPN sa tam nedostaneš).
2. Nechaj túto kartu otvorenú (poll na pozadí beží len kým je karta
   načítaná).
3. Otvor appku na `http://localhost:5173/` a panel živých logov —
   záznamy sa aktualizujú každé ~3s cez existujúcu Kibana session v
   prehliadači (žiadny API kľúč sa nikam neposiela).

Podrobnosti a riešenie problémov: `browser-extension/README.md`.

## 6. Zhrnutie overenia (čo bolo skontrolované)

- `browser-extension/manifest.json` a `background.js` — `localhost:5173`/
  `127.0.0.1:5173` sú explicitne v `host_permissions`/`content_scripts`/
  `APP_URL_PATTERNS`, nie iba `*.app.github.dev`. Žiadna zmena nebola
  potrebná.
- Server (`server/index.mjs`) nepoužíva žiadne CORS/origin nastavenia
  viazané na Codespace — appka aj API bežia na tom istom origin
  (`http://127.0.0.1:5173`), takže CORS sa vôbec netýka.
- `package.json` má nový `engines.node: ">=20.11.0"` záznam (kód používa
  `import.meta.dirname`).
- `server/.env` (s reálnym Elasticsearch API kľúčom pre Variant A) zostáva
  mimo gitu aj mimo pripraveného ZIP-u — nikdy sa neposiela von.
