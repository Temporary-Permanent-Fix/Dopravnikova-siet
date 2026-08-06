# Audit smerovania telemetrie SKLC3

`data/sklc3-telemetry-mapping.md` je autoritatívny pracovný zdroj. Test
`server/telemetry-mapping.test.mjs` ho pri každom spustení porovnáva s
`src/sklc3-telemetry.json` a s layoutom `src/sklc3.json`.

## Aktuálny stav

| Kontrola | Výsledok |
|---|---:|
| Vyplnené riadky v Markdown mapovaní | 72 |
| Unikátne dvojice `agent:direction` | 70 |
| Jednoznačné aktívne mapovania | 68 |
| Explicitne nejednoznačné mapovania | 2 |
| Hrany mimo layoutu alebo s nesprávnym zdrojovým agentom | 0 |

Opravené hodnoty zdroja pravdy sú `DS20:7 → e109` a
`DS24S26:11 → e119`.

## Nejednoznačné smerovania

Tieto eventy majú v súčasnom Kibana kontrakte iba `agent` a `direction`,
preto sa nesmú priradiť náhodne ani zobraziť na oboch hranách:

- `BPO01:6 → e361 | e364`
- `C3PO:6 → e40 | e129`

Sú uložené v `ambiguousMappings`. Server ich vracia v `unmappedEvents` s
`reason: "ambiguous-mapping"`, nulovým tokom a bez animácie. Pred ich
aktiváciou musí validácia v Kibane potvrdiť ďalší stabilný rozlišovací údaj.
