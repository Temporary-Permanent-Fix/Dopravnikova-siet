# SKLC3 live-events fixtures

Podkladové dáta pre `server/live-events.test.mjs`. Žiadny súbor tu neobsahuje
API kľúč, interné URL ani iné infraštruktúrne polia — pozri
`docs/elasticsearch-access-checklist.md`.

## Reálne (sanitizované) Kibana eventy

Tieto tri súbory sú doslovné kópie polí zo sanitizovaných ukážok v
[`docs/README-AI-next-steps.md`](../../docs/README-AI-next-steps.md)
(vytiahnuté z Kibany, tab *TMS - LCT Data for API*). Jediná pridaná hodnota
je `@timestamp` (v origináli bol pri sanitizácii odstránený spolu s ostatnými
infraštruktúrnymi poľami) — reprezentuje reálny tvar `_source` dokumentu.

| Súbor | Template | Agent | Poznámka |
|---|---|---|---|
| `real-box-routed.json` | `Box has been routed` | `DS24S26` | `direction=12` → `e66` (`DS24S26:12` v `src/sklc3-telemetry.json`) |
| `real-message-received.json` | `Message received` | `OBIWAN` | `topic=rur/plc/OBIWAN/occupation`, bez `direction`/`edgeId` |
| `real-arm-status.json` | `Arm status changed` | `OBIWAN` | ramená `0,6,9,12`; `OBIWAN` nemá v `src/sklc3-telemetry.json` žiadny mapovaný `direction`, takže všetky štyri skončia v `unmappedEvents` |

## Skonštruované (podľa reálnej šablóny) eventy

Tieto dva súbory majú identický tvar ako vyššie uvedené reálne ukážky, ale
polia (`agent`, `direction`/`Arms`) boli zámerne zvolené tak, aby pokryli
scenáre, ktoré v troch odovzdaných reálnych vzorkách chýbajú.

| Súbor | Template | Agent | Poznámka |
|---|---|---|---|
| `mapped-arm-status.json` | `Arm status changed` | `DS02S04` | ramená `7`, `11`, `12` sú mapované na `e84`, `e83`, `e11` — pokrýva obsadenosť hrán (`occupied`) pre agenta, ktorý *je* v `src/sklc3-telemetry.json`; rameno `99` nie je mapované, takže sa pridá do `unmappedEvents` popri troch mapovaných |
| `unmapped-box-routed.json` | `Box has been routed` | `DS24S26` | `direction=250` neexistuje v mapovaní pre `DS24S26` (má iba `12`) → skončí v `unmappedEvents` |

## Kibana query state (`POST /api/live/query`)

Podkladové dáta pre `server/index.integration.test.mjs`, telá požiadaviek na
`POST /api/live/query` (rozparsovaný stav z vloženého Kibana linku — čas.
rozsah, refresh interval, dopyt, filtre). Žiadny súbor tu neobsahuje reálny
Kibana link, len už rozparsovaný tvar (výstup `parseKibanaResultUrl()`).

| Súbor | Účel |
|---|---|
| `kibana-query-state-valid.json` | Platný stav — časový rozsah, refresh interval, KQL dopyt a jeden `match_phrase` filter; server ho má prijať (200) a premietnuť do `_search` dopytu. |
| `kibana-query-state-script-injection.json` | Filter s povoleným top-level kľúčom (`term`), ale so `script` kľúčom vnoreným hlbšie — overuje, že `assertNoScriptKey` v `validateQueryState` chytí aj neplytký pokus, nielen top-level whitelist; server má vrátiť 400 a nikdy sa nedostať k upstream ES fetchu. |
| `kibana-query-state-partial.json` | Iba `timeRange`, bez `query`/`filters`/`refreshInterval` — overuje partial-merge sémantiku (`/api/live/query` prepíše len polia, ktoré dostal). |
| `kibana-query-state-bool-filter.json` | Filter s top-level kľúčom `bool`/`should` (Kibana "je jedno z" — `phrases` filter, napr. `level: ERROR alebo warn`) — overuje, že `assertValidQueryClause` v `server/index.mjs` takéto skupinové filtre povolí a prenesie 1:1 do `_search`. |
| `kibana-query-state-bool-script-injection.json` | `script` kľúč vnorený vnútri `bool.should` klauzuly — overuje, že whitelist pre `bool` skupiny neobchádza `assertNoScriptKey`. |
| `kibana-query-state-bool-too-deep.json` | Päť vnorených `bool` úrovní (nad `MAX_BOOL_DEPTH`) — overuje limit hĺbky rekurzie. |

## Passívne segmenty

Pre `passiveSegment()` testy sa nepoužíva samostatná fixture — funkcia sa
testuje priamo nad reálnym layoutom `src/sklc3.json` a reálnym mapovaním
`src/sklc3-telemetry.json` (pozri `server/live-events.test.mjs`). Dôvod:
žiadna aktuálne namapovaná kombinácia `agent:direction` v
`src/sklc3-telemetry.json` dnes nevytvára viacúsekový pasívny segment (buď
vedie priamo na ďalšieho telemetry agenta, alebo sa vetví na `C3PO`/`R2D2`).
Skutočný viacúsekový reťazec (`e348 → e349 → e351 → e354`, cez uzly
`JoinerSorter08 → JoinerSorter12 → JoinerSorter01`) existuje v reálnom
layoute na vetve `OBIWAN`, ktorá zatiaľ nemá vyplnený `direction` (pozri
`docs/telemetry-mapping-audit.md`) — testuje sa preto priamo cez
`passiveSegment(startEdgeId, layout, telemetryAgents)`, nie cez
`buildSnapshot()`.
