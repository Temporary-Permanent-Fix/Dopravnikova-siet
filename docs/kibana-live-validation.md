# Validácia SKLC3 live napojenia na Kibanu

Tento postup vykoná operátor alebo Claude Code s read-only credentials.
Do repozitára nepatria URL clusteru, API kľúč ani nesanitizované eventy.

## Dátový kontrakt

Server číta iba dokumenty s jedným z týchto `messageTemplate`:

- `Box has been routed (boxCode='{BoxCode}'; direction={DirectionTo}).`
- `Arm status changed ({Arms})`
- `Message received (messageId={Id}; clientId={ClientId}; topic={Topic};)`

Požadované polia sú `@timestamp`, `headers.x-AgentName`, `messageTemplate`
a príslušné `messageParams`. Tieto polia server normalizuje bez parsovania
voľného poľa `message`.

## Kibana-link flow (vloženie filtra z Kibany)

> **Poznámka (2026-08-10):** tlačidlá **● Live** a **🔗 Kibana link** boli z
> `src/index.html` odstránené — v praxi bežala live vizualizácia takmer
> vždy cez browser extension (Variant B, `browser-extension/`), pretože
> `ELASTICSEARCH_URL` je interná k8s `.svc` adresa nedostupná mimo klastra
> (pozri "Runbook" nižšie). Na ich mieste je teraz panel **🔎 Filter**, ktorý
> filtruje **Live logs** (browser extension) — pozri
> `browser-extension/README.md` sekcia "Filtrovanie". Popis nižšie zostáva
> platný pre server-driven `/api/live/query`/`/api/live/config` endpointy
> (stále funkčné a testované, len bez UI vstupu) — relevantné, ak appku
> niekedy spustíš v sieti s priamym prístupom na ES (pozri Runbook).

Namiesto (alebo popri) manuálneho vypĺňania časového okna sa dá dopyt/filter/
auto-refresh prevziať priamo z Kibany, dvojkrokovo (POZOR: krok 1 nižšie
opisuje UI tlačidlo, ktoré už v appke nie je — endpoint `POST
/api/live/query` treba zavolať priamo, napr. cez `curl`, alebo znovu pridať
UI podľa potreby):

1. Operátor v appke klikne **🔗 Kibana link**, vloží Kibana base URL a appka
   ju otvorí v novej karte (`window.open`) — beží reálna Kibana relácia
   (vlastné prihlásenie, vlastné oprávnenia). Tam si operátor bežne nastaví
   časový rozsah, dopyt/filtre a auto-refresh.
2. Výslednú URL z Kibana karty (nesie `_g`/`_a` rison stav) skopíruje späť
   do appky a klikne **Použiť tento Kibana link**. Appka URL rozparsuje
   klientsky (`src/kibana-rison.mjs`, hand-rolled rison decoder — pokrýva len
   podmnožinu, ktorú Kibana `_g`/`_a` skutočne generuje) a pošle výsledok na
   `POST /api/live/query`. Server zostaví skutočný ES `_search` dopyt.
   Elasticsearch API kľúč/URL nikdy neopúšťajú server a appka od operátora
   **nikdy nepýta ani nezobrazuje API kľúč** — jediný zdroj pripojenia je
   `server/.env` (`LIVE_DATA_MODE=elasticsearch` +
   `ELASTICSEARCH_URL`/`ELASTICSEARCH_API_KEY`/`ELASTICSEARCH_INDEX`, ako je
   to v tomto repozitári teraz, pozri "Záznam overenia" nižšie). Ak tieto
   premenné nie sú nastavené, appka Kibana link odmietne použiť s chybou
   (`GET /api/live/config` vráti `configured:false`) — dovtedy neexistuje
   žiadny spôsob, ako pripojenie zadať cez prehliadač. Pripojenie je
   **zdieľané/globálne, nie per-browser izolované** — filter platí pre
   kohokoľvek, kto appku cez ten istý server otvorí, kým ho niekto
   neprepíše iným linkom alebo nezavolá `DELETE /api/live/config`, čo ho
   resetuje. Zámerný kompromis pre jednooperátorský interný nástroj.

Dôležité obmedzenia:

- **Dopyt (query bar text) sa prekladá len približne** — posiela sa ako
  `query_string` na `default_field: 'message'`, nie ako presná KQL/Lucene
  sémantika. Jednoduché `pole:hodnota`/free-text dopyty fungujú dobre;
  zložené KQL výrazy sa môžu správať inak než v reálnej Kibane.
- **Filtre (Kibana filter pills) sa prenášajú takmer 1:1** — Kibana ich už
  ukladá v natívnom ES DSL (`match_phrase`, `range`, ...), server ich len
  overí voči whitelistu povolených klauzúl (`match_phrase`, `match`, `term`,
  `terms`, `range`, `exists`) a rekurzívne odmietne čokoľvek so `script`
  kľúčom — vložený Kibana link je nedôveryhodný vstup (mohol prísť od
  niekoho iného cez chat/e-mail), takže táto validácia je povinná.
- **Kibana data view id ≠ názov ES indexu.** Appka to nevie vyriešiť bez
  Kibana session (mimo scope). Keď link nesie `dataViewId`, appka to zobrazí
  len ako informačnú poznámku a predvyplní pole indexom z už nastaveného
  server/.env pripojenia — **nevyžaduje to ručné
  potvrdenie ani neblokuje Použiť**. Operátor môže pole prepísať, ak vie, že
  konkrétny link patrí k inému indexu než ten aktuálne nastavený.
- `messageTemplate.keyword` terms filter (viď "Dátový kontrakt" vyššie)
  ostáva vždy natvrdo vynútený — pasovaný Kibana link ho nemôže rozšíriť ani
  obísť.
- Auto-refresh interval z Kibana linku (`refreshInterval.value`, clamp
  1–300 s) poháňa polling `GET /api/live/stream`; ak je v Kibane
  auto-refresh vypnutý (`pause: true`), appka použije vlastný predvolený
  `LIVE_POLL_INTERVAL_MS`, nie žiadny refresh.

## Kontrolný postup

1. Podľa `elasticsearch-access-checklist.md` over read-only API key a stabilný
   index/alias.
2. Vytiahni sanitizovaný dokument z každého z troch template a spusti
   `node --test server/*.test.mjs`.
3. Over, že `GET /api/live/snapshot` v režime `LIVE_DATA_MODE=elasticsearch`
   vracia `mode: "elasticsearch"`, čerstvý `latestObservedAt` a žiadne
   credentials.
4. Over, že `GET /api/live/stream` posiela event `snapshot` a UI ukazuje
   connected stav, source lag a aktualizovaný tok.
5. Pre `C3PO:6` a `BPO01:6` porovnaj viac eventov. Ak nenájdu stabilný
   rozlišovací údaj, ponechaj ich ako `ambiguous-mapping`.

## Výstup validácie

Zaznamenaj iba názov aliasu, potvrdené názvy polí, použité filtre a výsledok
dvoch nejednoznačných dvojíc. Nepíšte URL, API kľúč, box kódy ani kompletné
produkčné dokumenty.

## Runbook: spustenie live režimu v prostredí s prístupom do internej siete

Tento oddiel je pre operátora, ktorý spúšťa server v sieti/namespace, kde je
`ELASTICSEARCH_URL` skutočne dostupný (napr. rovnaká k8s sieť, alebo cez
`kubectl port-forward`). V bežnom vývojovom Codespace toto **nefunguje** —
interné `.svc` DNS mená sa odtiaľ nedajú vyriešiť.

1. **Priprav `server/.env`** (necommitovaný, `.gitignore` ho už vylučuje):
   ```
   LIVE_DATA_MODE=elasticsearch
   ELASTICSEARCH_URL=<interná URL clustera>
   ELASTICSEARCH_API_KEY=<hodnota z Kibany>
   ELASTICSEARCH_INDEX=<potvrdený index/alias>
   ```
   **Pozor na formát kľúča**: ak si z Kibany skopíroval pole `encoded`
   (žiadna `:` v hodnote), nechaj ho tak — `server/index.mjs` ho použije
   priamo. Ak máš surovú dvojicu `id:api_key`, tiež ho vlož tak ako je,
   server si ju sám zakóduje. **Kľúč sa nesmie ručne base64 kódovať pred
   vložením do `.env`** — presne tá istá logika platí aj pre kontrolné
   `curl` príkazy, pozri poznámku v `elasticsearch-access-checklist.md`
   sekcia 4.
2. **Over pole pre časový filter ešte pred spustením servera.** UI Discover
   niekedy ukazuje iné pole ako `@timestamp` (napr. `time_key`). Over to
   priamo na mapovaní indexu:
   ```bash
   curl -s -H "Authorization: $AUTH_HEADER" \
     "$ELASTICSEARCH_URL/$ELASTICSEARCH_INDEX/_mapping" \
     | grep -A3 '"time_key"\|"@timestamp"\|"dateTime"'
   ```
   Skontroluj, že pole, ktoré Discover používa ako sort field, je v
   mapovaní typu `date` (nie `keyword`/`text` — inak `range` dopyt na neho
   zlyhá alebo nič nevráti). Ak to nie je `@timestamp`, nastav v
   `server/.env`:
   ```
   ELASTICSEARCH_TIMESTAMP_FIELD=time_key
   ```
   (Táto premenná bola do `server/index.mjs` doplnená práve pre tento
   prípad — predtým bolo pole na `@timestamp` napevno zadrôtované.)
3. **Spusti server**: `npm start` (alebo `node server/index.mjs`).
   Konzola vypíše `... (elasticsearch)` — potvrdzuje, že sa nabehol
   správny režim. Appka nemá žiadny spôsob zadať API kľúč cez prehliadač —
   pripojenie sa vždy berie zo `server/.env` a Kibana link naň iba
   aplikuje query/filter/time-range stav (pozri "Kibana-link flow" vyššie).
4. **Spusti kontrolné `curl` príkazy zo sekcie 4** checklistu (4.1–4.4) —
   použi rovnaký `$AUTH_HEADER` postup ako v `.env` bode vyššie.
5. **Over HTTP endpoints servera** (nie priamo Elastic):
   ```bash
   curl -s http://localhost:5173/api/health
   curl -s http://localhost:5173/api/live/snapshot | head -c 500
   ```
   `snapshot` musí vrátiť `"mode":"elasticsearch"`, neprázdny
   `latestObservedAt` a **žiadne** credentials/URL v tele odpovede (server
   ich zámerne neposiela do klienta, pozri `liveErrorBody()`).
6. **Ak `snapshot` vráti `503`**, pozri server log (nie odpoveď klienta) —
   po dnešnej úprave obsahuje detail (DNS/connect zlyhanie, timeout, alebo
   HTTP status + skrátené telo odpovede z Elasticu), aby sa dalo rýchlo
   rozlíšiť zlá sieť/DNS od zlého kľúča od zlého indexu.
7. Otvor `src/index.html` cez server (`http://localhost:5173/`) a over, že
   UI ukazuje connected stav, aktuálny `sourceLagSeconds` a tok na hranách.

## Záznam overenia (2026-07-29, Claude Code)

**Aktualizácia (2026-07-29, popoludní):** `server/.env` je teraz vyplnený
(operátor): `LIVE_DATA_MODE=elasticsearch`, `ELASTICSEARCH_INDEX=
k8s-logistics-core-prd-wtmsklc3int`, read-only API kľúč
`sklc3-live-readonly` (Kibana Security API, inline restrict privileges,
`read` + `view_index_metadata` na jednom indexe). `ELASTICSEARCH_URL` je
interný k8s service DNS názov (`*.svc:9200`) — **z tohto Codespace
nedostupný** (`curl: (6) Could not resolve host`), takže živé `curl`
kontroly a živé HTTP odpovede servera stále nebolo možné overiť priamo
tu. `npm test` po úprave `.env` naďalej 24/24 zelené (mock režim nepoužíva
sieť). V rámci tejto úlohy boli spravené tri zmeny v kóde/dokumentácii
(pozri nižšie "Zmeny spravené 2026-07-29"), aby bol server odolnejší a aby
runbook zodpovedal reálnemu tvaru kľúča a indexu — samotné pripojenie na
Elasticsearch je stále NEOVERENÉ a vyžaduje spustenie v sieti s prístupom
k danému k8s namespace (alebo `port-forward`).

Pôvodný zápis nižšie (spred vyplnenia `.env`) je ponechaný pre kontext:
overenie bolo dovtedy iba **statickou kontrolou kódu a existujúcej
dokumentácie**, nie dopytom na reálny cluster. Body označené NEOVERENÉ
vyžadujú operátora s prístupom do internej siete.

**Dopyt a kontrakt** (`server/index.mjs` → `elasticsearchSnapshot()`,
`server/live-events.mjs`):

- `POST $ELASTICSEARCH_URL/$ELASTICSEARCH_INDEX/_search`, filtre: `range`
  na `@timestamp` (posledných `LIVE_WINDOW_SECONDS` sekúnd) a `terms` na
  `messageTemplate.keyword` obmedzené presne na tri podporované šablóny
  (`elasticTemplates`). Voliteľné `term` filtre na `namespace_name` /
  `container_name` sa pridajú, iba ak sú nastavené `ELASTICSEARCH_NAMESPACE`
  / `ELASTICSEARCH_CONTAINER`.
- `_source` je explicitne obmedzený na `@timestamp, time_key, dateTime,
  messageTemplate, messageParams, headers.x-AgentName, agent, direction,
  boxCode, topic` — žiadne iné polia sa nenačítavajú.
- Timestamp field: bolo `@timestamp` napevno (fallback `time_key` /
  `dateTime` iba pri normalizácii, nie v samotnom ES dopyte). **Od
  2026-07-29 nakonfigurovateľné** cez `ELASTICSEARCH_TIMESTAMP_FIELD`,
  keďže Discover pre `k8s-logistics-core-prd-wtmsklc3int` ukazuje
  `time_key` ako sort field — skutočná hodnota je stále NEOVERENÁ (potrebná
  kontrola `_mapping`, pozri Runbook bod 2).
- Autoritatívny agent field: `headers["x-AgentName"]` (fallback
  `source.agent`, iba ak by hlavička chýbala).
- Index/alias názov a reálna dostupnosť všetkých 70 namapovaných
  `agent:direction` kľúčov v clustri: **NEOVERENÉ** — čisto operátorská
  konfigurácia a živý dopyt, ktoré v tomto prostredí neboli k dispozícii.

**Nejednoznačné dvojice `C3PO:6` a `BPO01:6`:**

- V sanitizovaných vzorkách dostupných v repozitári
  (`docs/README-AI-next-steps.md`, `server/fixtures/`) nie je žiadny reálny
  dokument pre tieto dva agenty, preto nebolo možné porovnať viac eventov a
  hľadať stabilný rozlišovací údaj (napr. iný `logger`, doplnkové pole).
  **Stav zostáva NEROZHODNUTÝ**, rovnako ako predpokladá zadanie úlohy.
- Bezpečný fallback je potvrdený automatizovaným testom (`buildSnapshot: an
  ambiguous mapping is diagnosed and never animates either edge`, pozri
  `npm test` → 24/24 prešlo): obe dvojice sú v `ambiguousMappings`, vracajú
  sa v `unmappedEvents` s `reason: "ambiguous-mapping"`, nulovým tokom a bez
  animácie.
- **Zámerne sa `ambiguousMappings` v `src/sklc3-telemetry.json` teraz
  nemení** — bez reálnych sanitizovaných eventov by šlo o hádanie, a
  nesprávne rozviazanie by mohlo animovať zlú hranu.

### TODO: čo doložiť pre rozhodnutie `C3PO:6` / `BPO01:6`

Podľa vzoru, akým Codex dodal vzorky do
[`docs/README-AI-next-steps.md`](README-AI-next-steps.md) (ručne
sanitizované, bez `master_url`/`pod_ip`/`host`/`container_image`, bez API
kľúča a URL):

1. Vytiahni z Kibany 2–3 reálne dokumenty pre `agent=C3PO` a `direction=6`
   a rovnako pre `agent=BPO01` a `direction=6` (typicky `Arm status
   changed` alebo `Box has been routed` eventy, podľa toho, čo sa pre tieto
   agenty reálne loguje).
2. Sanitizuj ich rovnakým postupom ako v `README-AI-next-steps.md` (ponechaj
   `message`, `messageTemplate`, `messageParams`, `level`, `logger`,
   `headers.x-AgentName`; odstráň infraštruktúrne polia).
3. Vlož ich buď:
   - ako novú sekciu do `docs/README-AI-next-steps.md` (rovnaký formát ako
     existujúce tri príklady), alebo
   - priamo sem do tohto súboru pod túto TODO sekciu.
4. Až s týmito vzorkami rozhodni, či existuje stabilný rozlišovací údaj
   (iný `logger`, iné pole v `messageParams`, iný `topic` a pod.) medzi
   dvojicami hrán `["e361", "e364"]` (`BPO01:6`) a `["e40", "e129"]`
   (`C3PO:6`) v `src/sklc3-telemetry.json`. Ak áno, uprav
   `ambiguousMappings` → `mappings` v samostatnej zmene (mimo tejto úlohy)
   a doplň test v `server/live-events.test.mjs`.
5. Ak sa rozlišovač nenájde, dvojice zostávajú v `ambiguousMappings`
   natrvalo — to je bezpečné (žiadna animácia zlej hrany), iba menej presné.

**Zostávajúce blokujúce položky pred úplnou live validáciou:**

1. ~~Read-only `ELASTICSEARCH_URL` + `ELASTICSEARCH_API_KEY` +
   `ELASTICSEARCH_INDEX` dodané operátorom mimo tohto chatu~~ — **hotové
   2026-07-29**: `server/.env` je vyplnený, index
   `k8s-logistics-core-prd-wtmsklc3int`, read-only kľúč `sklc3-live-readonly`
   vytvorený cez Kibana Security API (inline restrict privileges).
2. Fyzický/sieťový prístup k `ELASTICSEARCH_URL` — je to interný k8s
   service DNS názov (`*.svc:9200`), z tohto Codespace nedostupný
   (`Could not resolve host`). Curl kontroly zo sekcie 4 checklistu a
   živé spustenie servera (`LIVE_DATA_MODE=elasticsearch`) treba spustiť
   v prostredí s prístupom do rovnakej k8s siete/namespace, alebo cez
   `kubectl port-forward`.
3. Potvrdenie časového poľa priamo v mapovaní indexu (`@timestamp` vs.
   `time_key` vs. iné) — postup je v sekcii "Runbook" vyššie. Kód už
   podporuje oboje cez `ELASTICSEARCH_TIMESTAMP_FIELD`, len treba
   potvrdiť skutočnú hodnotu a nastaviť ju v `server/.env`, ak nie je
   `@timestamp`.
4. Minimálne 2–3 reálne eventy pre `C3PO:6` a `BPO01:6` na posúdenie
   rozlišovača — pozri TODO sekciu vyššie.

## Zmeny spravené 2026-07-29 (Claude Code, bez sieťového prístupu)

Kód bol upravený lokálne v repozitári, bez odoslania akéhokoľvek kľúča/URL
mimo neho, na základe zistení operátora v tejto úlohe:

- `server/index.mjs` — `elasticsearchSnapshot()` teraz zachováva
  `error.cause` a pri neúspešnom HTTP statuse loguje aj (skrátené) telo
  odpovede, takže server log rozlíši DNS/connect zlyhanie, timeout, zlý
  kľúč (401) a nedostatočné práva (403) namiesto jednej generickej hlášky.
  Klientovi (`/api/live/snapshot`, `/api/live/stream`) sa naďalej posiela
  iba neutrálna správa — infraštruktúrne detaily zostávajú len v serverovom
  logu.
- `server/index.mjs` — pridaná `ELASTICSEARCH_TIMESTAMP_FIELD` (default
  `@timestamp`), použitá v `range` filtri aj `sort` namiesto natvrdo
  zadrôtovaného `@timestamp`. Dôvod: Discover pre
  `k8s-logistics-core-prd-wtmsklc3int` ukazuje `time_key` ako sort field.
- `server/.env.example` — zdokumentovaná nová premenná.
- `docs/elasticsearch-access-checklist.md` — opravená chyba v sekcii 4:
  pôvodné `curl` príkazy vždy base64-kódovali `ELASTICSEARCH_API_KEY`, čo
  by pri už base64-enkódovanej hodnote (`encoded` z Kibany, bez `:`)
  spôsobilo dvojité kódovanie a neplatnú `Authorization` hlavičku (`401`
  namiesto zmysluplného výsledku). Príkazy teraz používajú `$AUTH_HEADER`
  odvodený rovnakou logikou, akú má `authorizationHeader()` v
  `server/index.mjs`.
- Testy (`node --test server/*.test.mjs`) po všetkých úpravách naďalej
  24/24 zelené — zmeny sa netýkajú mock režimu ani `buildSnapshot`/
  `normalizeLiveEvent` logiky.
- Automatický fallback z `elasticsearch` na `mock` režim pri výpadku ES
  **zámerne nebol pridaný** — tichý prechod na mock dáta by v produkcii
  vyzeral ako funkčný tok a maskoval by výpadok namiesto toho, aby ho
  ukázal ako `503`/error event. Súčasné správanie (jasná chyba na
  klientovi + diagnostický detail v serverovom logu) bolo vyhodnotené ako
  bezpečnejšie.
