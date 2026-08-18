# SKLC3 → Kibana smerovanie

Tento súbor je pracovná pomôcka na prepojenie Kibana eventov s pásmi v SKLC3.

## Ako dopĺňať

- Za `direction:` napíš číslo smeru z Kibany, napríklad `12`.
- Jeden riadok znamená: event z daného **agenta** so zvoleným smerom ide po uvedenej hrane k uvedenému cieľu.
- Ak smer nevieš alebo technológia neposiela `Box has been routed`, nechaj pole prázdne.
- Nemeň názov agenta ani ID hrany (`e…`). Po vyplnení súbor ulož; Codex údaje prenesie do `src/sklc3.json`.

Príklad:

```text
- e83 → S04 | direction: 12
```

## DS01S03

- e7 → DS02S04 | direction: 6
- e454 → S03 | direction: 7
- e453 → S01 | direction: 11

## DS02S04

- e452 → S02 | direction: 7
- e83 → S04 | direction: 11
- e11 → DS05 | direction: 12

## DS05

- e14 → DS06 | direction: 6
- e73 → S05 | direction: 11

## DS06

- e74 → S06 | direction: 11
- e17 → DS07S09 | direction: 12

## DS07S09

- e23 → DS08S10 | direction: 6
- e79 → S09 | direction: 7
- e80 → S07 | direction: 11

## DS08S10

- e81 → S08 | direction: 7
- e82 → S10 | direction: 11
- e26 → DS11 | direction: 12

## DS11

- e34 → DS12 | direction: 6
- e87 → S11 | direction: 11

## DS12

- e89 → S12 | direction: 7
- e35 → DS14 | direction: 12

## DS13

- e46 → DS16S18 | direction: 6
- e44 → S13 | direction: 7

## DS14

- e91 → S14 | direction: 11
- e38 → C3PO | direction: 12

## DS15S17

- e55 → DS20 | direction: 6
- e95 → S17 | direction: 7
- e94 → S15 | direction: 11

## DS16S18

- e92 → S16 | direction: 7
- e93 → S18 | direction: 11
- e51 → DS15S17 | direction: 12

## DS19S21

- e62 → DS24S26 | direction: 6
- e115 → S21 | direction: 7
- e113 → S19 | direction: 11

## DS20

- e109 → S20 | direction: 7
- e58 → DS22 | direction: 12

## DS22

- e111 → S22 | direction: 11
- e60 → DS19S21 | direction: 12

## DS23

- e100 → DS28 | direction: 6
- e121 → S23 | direction: 11

## DS24S26

- e118 → S24 | direction: 7
- e119 → S26 | direction: 11
- e66 → DS23 | direction: 12

## DS28

- e123 → S28 | direction: 7
- e101 → DS30 | direction: 12

## DS30

- e125 → S30 | direction: 7
- e102 → R2D2 | direction: 12

## Ostatné agenty z layoutu

### ANAKIN

- e421 → JoinerAS01 | direction: 6
- e423 → JoinerAS02 | direction: 9

### BB4

- e135 → BB4Error | direction: 3
- e127 → JoinerSPO02 | direction: 9

### BB8

- e133 → BB8Error | direction: 6
- e105 → JoinerSPO01 | direction: 9

### BPO01

- e364 → Joiner / Y 4 | direction: 9
- e361 → JoinerSorter10 | direction: 12

### C3PO

- e129 → Sjezd na severni sorter | direction: 6
- e40 → JoinerSPO02 | direction: 9

### DARTHVADER

- e420 → JoinerAS01 | direction: 9
- e418 → JoinerSorter11 | direction: 12

### DOOKU

- e440 → JoinerAS02 | direction: 6
- e450 → JoinerAS06 | direction: 9

### DSO01

- e371 → SO01 | direction: 6
- e376 → SL40L57 | direction: 9

### KYLOREN

- e451 → JoinerAS06 | direction: 6
- e439 → JoinerAS04 | direction: 9

### LUKE

- e359 → Joiner / Y 4 | direction: 6
- e365 → JoinerSorter10 | direction: 9

### OBIWAN

- e367 → JoinerSorter11 | direction: 6
- e348 → JoinerSorter08 | direction: 9

### R2D2

- e131 → Sjezd na jizni sorter | direction: 6
- e104 → JoinerSPO01 | direction: 9

### SIDIOUS

- e427 → JoinerAS03 | direction: 9
- e425 → ANAKIN | direction: 12

### SL01AL18A

- e188 → L01A | direction: 1
- e187 → L02a | direction: 2
- e186 → L03a | direction: 3
- e185 → L04a | direction: 4
- e184 → L05a | direction: 5
- e183 → L06a | direction: 6
- e182 → L07a | direction: 7
- e181 → L08a | direction: 8
- e180 → L09a | direction: 9
- e179 → L10a | direction: 10
- e178 → L11a | direction: 11
- e177 → L12a | direction: 12
- e176 → L13a | direction: 13
- e175 → L14a | direction: 14
- e174 → L15a | direction: 15
- e173 → L16a | direction: 16
- e172 → L17a | direction: 17
- e224 → SL19AL38A | direction: 41

### SL01BL16B

- e307 → L01b | direction: 1
- e308 → L02b | direction: 2
- e309 → L03b | direction: 3
- e310 → L04b | direction: 4
- e311 → L05b | direction: 5
- e312 → L06b | direction: 6
- e313 → L07b | direction: 7
- e314 → L08b | direction: 8
- e315 → L09b | direction: 9
- e316 → L10b | direction: 10
- e317 → L11b | direction: 11
- e318 → L12b | direction: 12
- e319 → L13b | direction: 13
- e320 → L14b | direction: 14
- e321 → L15b | direction: 15
- e322 → L16b | direction: 16
- e344 → JoinerSorter08 | direction: 38

### SL17BL35B

- e290 → L17b | direction: 16
- e289 → L18b | direction: 18
- e288 → L19b | direction: 19
- e284 → L20b | direction: 20
- e283 → L21b | direction: 21
- e282 → L22b | direction: 22
- e281 → L23b | direction: 23
- e280 → L24b | direction: 24
- e279 → L25b | direction: 25
- e278 → L26b | direction: 26
- e277 → L27b | direction: 27
- e276 → L28b | direction: 28
- e275 → L29b | direction: 29
- e274 → L30b | direction: 30
- e273 → L31b | direction: 31
- e272 → L32b | direction: 32
- e271 → L33b | direction: 33
- e270 → L34b | direction: 34
- e269 → L35b | direction: 35
- e334 → JoinerSorter05 | direction: 40

### SL19AL38A

- e247 → L19a | direction: 19
- e246 → L20a | direction: 20
- e245 → L21a | direction: 21
- e244 → L22a | direction: 22
- e243 → L23a | direction: 23
- e242 → L24a | direction: 24
- e241 → L25a | direction: 25
- e240 → L26a | direction: 26
- e239 → L27a | direction: 27
- e238 → L28a | direction: 28
- e237 → L29a | direction: 29
- e236 → L30a | direction: 30
- e235 → L31a | direction: 31
- e234 → L32a | direction: 32
- e233 → L33a | direction: 33
- e232 → L34a | direction: 34
- e231 → L35a | direction: 35
- e230 → L36a | direction: 36
- e229 → L37a | direction: 37
- e228 → L38a | direction: 38
- e324 → Joiner / Y 3 | direction: 42

### SL40L57

- e386 → L40 | direction: 40
- e387 → L41 | direction: 41
- e388 → L42 | direction: 42
- e389 → L43 | direction: 43
- e390 → L44 | direction: 44
- e391 → L45 | direction: 45
- e392 → L46 | direction: 46
- e393 → L47 | direction: 47
- e404 → L48 | direction: 48
- e405 → L49 | direction: 49
- e406 → L50 | direction: 50
- e407 → L51 | direction: 51
- e408 → L52 | direction: 52
- e409 → L53 | direction: 53
- e410 → L54 | direction: 54
- e411 → L55 | direction: 55
- e412 → L56 | direction: 56
- e413 → L57 | direction: 57
- e377 → LUKE | direction: 58

### YODA

- e342 → JoinerSorter07 | direction: 6
- e338 → JoinerSorter06 | direction: 9
