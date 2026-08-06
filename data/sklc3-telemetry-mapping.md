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
- e85 → S03 | direction:7
- e86 → S01 | direction: 11

## DS02S04

- e11 → DS05 | direction: 12
- e83 → S04 | direction: 11
- e84 → S02 | direction: 7

## DS05

- e14 → DS06 | direction: 11
- e73 → S05 | direction: 6

## DS06

- e17 → DS07S09 | direction: 12
- e74 → S06 | direction: 11

## DS07S09

- e23 → DS08S10 | direction: 6
- e79 → S09 | direction: 7
- e80 → S07 | direction: 11

## DS08S10

- e26 → DS11 | direction: 12
- e81 → S08 | direction: 7
- e82 → S10 | direction: 11

## DS11

- e34 → DS12 | direction: 6
- e87 → S11 | direction: 11

## DS12

- e35 → DS14 | direction: 12
- e89 → S12 | direction: 7

## DS13

- e44 → S13 | direction:  7
- e46 → DS16S18 | direction: 6

## DS14

- e38 → C3PO | direction: 12
- e91 → S14 | direction: 11

## DS15S17

- e55 → DS20 | direction: 6
- e94 → S15 | direction: 11
- e95 → S17 | direction: 7

## DS16S18

- e51 → DS15S17 | direction: 12
- e92 → S16 | direction: 7
- e93 → S18 | direction: 11

## DS19S21

- e62 → DS24S26 | direction: 6
- e113 → S19 | direction: 11
- e115 → S21 | direction: 7

## DS20

- e58 → DS22 | direction: 12
- e109 → S20 | direction: 7

## DS22

- e60 → DS19S21 | direction: 12
- e111 → S22 | direction: 11

## DS23

- e100 → DS28 | direction: 6
- e121 → S23 | direction: 11

## DS24S26

- e66 → DS23 | direction: 12
- e118 → S24 | direction: 7
- e119 → S26 | direction: 11

## DS28

- e101 → DS30 | direction: 12
- e123 → S28 | direction: 7

## DS30

- e102 → R2D2 | direction: 12
- e125 → S30 | direction: 7

## Ostatné agenty z layoutu

### ANAKIN
- e421 → JoinerAS01 | direction: 6
- e423 → JoinerAS02 | direction: 9

### BB4
- e127 → JoinerSPO02 | direction: 9
- e135 → BB4Error | direction: 3

### BB8
- e105 → JoinerSPO01 | direction: 9
- e133 → BB8Error | direction: 6

### BPO01
- e361 → JoinerSorter10 | direction: 6
- e364 → Joiner / Y 4 | direction: 6

### C3PO
- e40 → JoinerSPO02 | direction: 6
- e129 → Sjezd na severni sorter | direction: 6

### DARTHVADER
- e418 → JoinerSorter11 | direction: 6
- e420 → JoinerAS01 | direction: 9

### DOOKU
- e440 → JoinerAS02 | direction: 6
- e450 → JoinerAS06 | direction: 9

### KYLOREN
- e439 → JoinerAS04 | direction: 9
- e451 → JoinerAS06 | direction: 6

### LUKE
- e359 → Joiner / Y 4 | direction: 6
- e365 → JoinerSorter10 | direction: 9

### OBIWAN
- e348 → JoinerSorter08 | direction: 9
- e367 → JoinerSorter11 | direction: 6

### R2D2
- e104 → JoinerSPO01 | direction: 9
- e131 → Sjezd na jizni sorter | direction: 6

### SIDIOUS
- e425 → ANAKIN | direction: 12
- e427 → JoinerAS03 | direction: 9

### YODA
- e338 → JoinerSorter06 | direction: 9
- e342 → JoinerSorter07 | direction: 6
