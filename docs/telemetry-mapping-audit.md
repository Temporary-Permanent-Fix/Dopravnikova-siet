# Audit smerovania telemetrie SKLC3

Tento dokument porovnáva `data/sklc3-telemetry-mapping.md` (pracovná pomôcka
agent → edgeId → direction) a `src/sklc3-telemetry.json` (aktívne mapovanie
`"AGENT:direction": "edgeId"` použité aplikáciou) voči layoutu
`src/sklc3.json` (uzly a hrany). Ide o read-only audit — žiadny existujúci
súbor nebol zmenený.

## Metodika

1. Zo `sklc3-telemetry-mapping.md` bolo vyparsovaných 72 riadkov v tvare
   `agent, edgeId, cieľový uzol (podľa dokumentu), direction`.
2. Zo `sklc3-telemetry.json` bolo načítaných 46 aktívnych záznamov
   `"AGENT:direction": "edgeId"`.
3. Pre každý `edgeId` bol dohľadaný skutočný `from`/`to` uzol v
   `src/sklc3.json` (`edges[].from` / `edges[].to`, preložené na `label`
   z `nodes[]`).
4. Skontrolované boli:
   - existencia každého `edgeId` z oboch zdrojov v layoute,
   - zhoda cieľového uzla uvedeného v `sklc3-telemetry-mapping.md` so
     skutočným `to` uzlom hrany v layoute,
   - zhoda agenta uvedeného v `sklc3-telemetry-mapping.md` so skutočným
     `from` uzlom hrany v layoute,
   - duplicitné `edgeId` (rovnaká hrana priradená viackrát rôznym
     `agent:direction` kombináciám) v oboch zdrojoch,
   - hrany vychádzajúce z diverterov v layoute, ktoré nie sú pokryté ani
     v jednom zo zdrojov (potenciálne chýbajúce záznamy).

## Súhrn zistení

| Kontrola | Výsledok |
|---|---|
| `edgeId` z `sklc3-telemetry-mapping.md` chýbajúce v layoute `src/sklc3.json` | **0** |
| `edgeId` z `sklc3-telemetry.json` chýbajúce v layoute `src/sklc3.json` | **0** |
| Nezhoda cieľového uzla (dokument vs. skutočný `to` uzol hrany) | **0** |
| Nezhoda agenta (dokument vs. skutočný `from` uzol hrany) | **0** |
| Duplicitné `edgeId` v `sklc3-telemetry-mapping.md` | **0** |
| Duplicitné `edgeId` v `sklc3-telemetry.json` | **0** |
| Hrany z diverterov v layoute nepokryté ani jedným zo zdrojov | **0** |
| Riadky v `sklc3-telemetry-mapping.md` bez vyplneného `direction` (teda chýbajúce v `sklc3-telemetry.json`) | **26** |

Žiadne duplicity ani nekonzistencie medzi dokumentom, JSON mapovaním a
layoutom neboli nájdené. Jediný otvorený bod je **26 riadkov bez direction**
— ide o agentov mimo hlavnej trasy DS01S03…DS30 (C3PO, R2D2, BB8, BB4,
YODA, OBIWAN, LUKE, BPO01, DARTHVADER, ANAKIN, SIDIOUS, KYLOREN, DOOKU),
pre ktoré `sklc3-telemetry-mapping.md` explicitne necháva `direction:`
prázdne (technológia buď nemá priradený smer, alebo neposiela
`Box has been routed`) — tieto preto logicky chýbajú aj v aktívnom
`src/sklc3-telemetry.json`.

## Detailná tabuľka

Stĺpec **V telemetry JSON** = `Áno`, ak `src/sklc3-telemetry.json` obsahuje
kľúč `"AGENT:direction"` mapovaný presne na daný `edgeId`.

| Agent | Direction | edgeId | Uzol odkiaľ | Uzol kam | V telemetry JSON |
|---|---|---|---|---|---|
| DS01S03 | 6 | e7 | DS01S03 | DS02S04 | Áno |
| DS01S03 | 7 | e85 | DS01S03 | S03 | Áno |
| DS01S03 | 11 | e86 | DS01S03 | S01 | Áno |
| DS02S04 | 12 | e11 | DS02S04 | DS05 | Áno |
| DS02S04 | 11 | e83 | DS02S04 | S04 | Áno |
| DS02S04 | 7 | e84 | DS02S04 | S02 | Áno |
| DS05 | 11 | e14 | DS05 | DS06 | Áno |
| DS05 | 6 | e73 | DS05 | S05 | Áno |
| DS06 | 12 | e17 | DS06 | DS07S09 | Áno |
| DS06 | 11 | e74 | DS06 | S06 | Áno |
| DS07S09 | 6 | e23 | DS07S09 | DS08S10 | Áno |
| DS07S09 | 7 | e79 | DS07S09 | S09 | Áno |
| DS07S09 | 11 | e80 | DS07S09 | S07 | Áno |
| DS08S10 | 12 | e26 | DS08S10 | DS11 | Áno |
| DS08S10 | 7 | e81 | DS08S10 | S08 | Áno |
| DS08S10 | 11 | e82 | DS08S10 | S10 | Áno |
| DS11 | 6 | e34 | DS11 | DS12 | Áno |
| DS11 | 11 | e87 | DS11 | S11 | Áno |
| DS12 | 12 | e35 | DS12 | DS14 | Áno |
| DS12 | 7 | e89 | DS12 | S12 | Áno |
| DS14 | 12 | e38 | DS14 | C3PO | Áno |
| DS14 | 11 | e91 | DS14 | S14 | Áno |
| C3PO | *(chýba)* | e40 | C3PO | JoinerSPO02 | Nie |
| C3PO | *(chýba)* | e129 | C3PO | Sjezd na severni sorter | Nie |
| DS13 | 7 | e44 | DS13 | S13 | Áno |
| DS13 | 6 | e46 | DS13 | DS16S18 | Áno |
| DS16S18 | 12 | e51 | DS16S18 | DS15S17 | Áno |
| DS16S18 | 7 | e92 | DS16S18 | S16 | Áno |
| DS16S18 | 11 | e93 | DS16S18 | S18 | Áno |
| DS15S17 | 6 | e55 | DS15S17 | DS20 | Áno |
| DS15S17 | 11 | e94 | DS15S17 | S15 | Áno |
| DS15S17 | 7 | e95 | DS15S17 | S17 | Áno |
| DS20 | 12 | e58 | DS20 | DS22 | Áno |
| DS20 | 77 | e109 | DS20 | S20 | Áno |
| DS22 | 12 | e60 | DS22 | DS19S21 | Áno |
| DS22 | 11 | e111 | DS22 | S22 | Áno |
| DS19S21 | 6 | e62 | DS19S21 | DS24S26 | Áno |
| DS19S21 | 11 | e113 | DS19S21 | S19 | Áno |
| DS19S21 | 7 | e115 | DS19S21 | S21 | Áno |
| DS24S26 | 12 | e66 | DS24S26 | DS23 | Áno |
| DS24S26 | 7 | e118 | DS24S26 | S24 | Áno |
| DS24S26 | 26 | e119 | DS24S26 | S26 | Áno |
| DS23 | 6 | e100 | DS23 | DS28 | Áno |
| DS23 | 11 | e121 | DS23 | S23 | Áno |
| DS28 | 12 | e101 | DS28 | DS30 | Áno |
| DS28 | 7 | e123 | DS28 | S28 | Áno |
| DS30 | 12 | e102 | DS30 | R2D2 | Áno |
| DS30 | 7 | e125 | DS30 | S30 | Áno |
| R2D2 | *(chýba)* | e104 | R2D2 | JoinerSPO01 | Nie |
| R2D2 | *(chýba)* | e131 | R2D2 | Sjezd na jizni sorter | Nie |
| BB8 | *(chýba)* | e105 | BB8 | JoinerSPO01 | Nie |
| BB8 | *(chýba)* | e133 | BB8 | BB8Error | Nie |
| BB4 | *(chýba)* | e127 | BB4 | JoinerSPO02 | Nie |
| BB4 | *(chýba)* | e135 | BB4 | BB4Error | Nie |
| YODA | *(chýba)* | e338 | YODA | JoinerSorter06 | Nie |
| YODA | *(chýba)* | e342 | YODA | JoinerSorter07 | Nie |
| OBIWAN | *(chýba)* | e348 | OBIWAN | JoinerSorter08 | Nie |
| OBIWAN | *(chýba)* | e367 | OBIWAN | JoinerSorter11 | Nie |
| LUKE | *(chýba)* | e359 | LUKE | Joiner / Y 4 | Nie |
| LUKE | *(chýba)* | e365 | LUKE | JoinerSorter10 | Nie |
| BPO01 | *(chýba)* | e361 | BPO01 | JoinerSorter10 | Nie |
| BPO01 | *(chýba)* | e364 | BPO01 | Joiner / Y 4 | Nie |
| DARTHVADER | *(chýba)* | e418 | DARTHVADER | JoinerSorter11 | Nie |
| DARTHVADER | *(chýba)* | e420 | DARTHVADER | JoinerAS01 | Nie |
| ANAKIN | *(chýba)* | e421 | ANAKIN | JoinerAS01 | Nie |
| ANAKIN | *(chýba)* | e423 | ANAKIN | JoinerAS02 | Nie |
| SIDIOUS | *(chýba)* | e425 | SIDIOUS | ANAKIN | Nie |
| SIDIOUS | *(chýba)* | e427 | SIDIOUS | JoinerAS03 | Nie |
| KYLOREN | *(chýba)* | e439 | KYLOREN | JoinerAS04 | Nie |
| KYLOREN | *(chýba)* | e451 | KYLOREN | JoinerAS06 | Nie |
| DOOKU | *(chýba)* | e440 | DOOKU | JoinerAS02 | Nie |
| DOOKU | *(chýba)* | e450 | DOOKU | JoinerAS06 | Nie |

## Odporúčanie

Pre 26 riadkov s prázdnym `direction` (agenti mimo hlavnej DSxx trasy) je
potrebné doplniť skutočné Kibana `direction` hodnoty do
`data/sklc3-telemetry-mapping.md` (podľa návodu v hlavičke tohto súboru),
následne ich prenesie Codex do `src/sklc3-telemetry.json`. Do tohto auditu
neboli tieto zásahy vykonané — dokument je len read-only porovnanie.
