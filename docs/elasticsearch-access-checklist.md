# Elasticsearch – prevádzkový návod pre SKLC3 live vizualizáciu

Tento návod popisuje, ako pripraviť **read-only** prístup do Elasticsearch
pre `LIVE_DATA_MODE=elasticsearch` v `server/index.mjs` (pozri
`server/.env.example`). Server sa štandardne spúšťa v `mock` režime;
v režime `elasticsearch` číta posledné udalosti priamo z Elasticsearch.

> Tento súbor je čisto dokumentačný. Nemení `server/`, `src/` ani
> `package.json` — iba popisuje postup, ktorý má vykonať operátor/DevOps
> mimo repozitára.

## 1. Minimálne read-only Elasticsearch oprávnenia

Vytvor v Kibane (**Stack Management → API keys** alebo cez
`Security API`) API kľúč naviazaný na **vlastnú rolu**, nie na existujúceho
používateľa s administrátorskými právami. Rola musí obsahovať výhradne:

- **Cluster privileges**: žiadne (prázdne pole `cluster: []`), prípadne
  iba `monitor` ak monitoring nástroj vyžaduje cluster health.
- **Index privileges** obmedzené na konkrétny index/alias/data stream
  (hodnota `ELASTICSEARCH_INDEX` nižšie):
  - `read`
  - `view_index_metadata`
- **Žiadne** z nasledovných práv: `write`, `delete`, `create_index`,
  `delete_index`, `manage`, `all`.
- **Žiadny prístup** k iným indexom/aliasom mimo tej jednej stabilnej
  data stream/alias, ktorú SKLC3 číta.

Príklad definície role (`role_descriptors` pri vytváraní API kľúča):

```json
{
  "sklc3-readonly": {
    "cluster": [],
    "indices": [
      {
        "names": ["${ELASTICSEARCH_INDEX}"],
        "privileges": ["read", "view_index_metadata"]
      }
    ]
  }
}
```

Nahraď `${ELASTICSEARCH_INDEX}` skutočným názvom aliasu/data stream —
nikdy nepoužívaj wildcard (`*`) ani `logs-*`, aby kľúč nemal prístup k
dátam mimo SKLC3.

## 2. Požadované environment premenné

Zodpovedajú premenným už pripraveným v `server/.env.example`:

| Premenná | Popis | Príklad |
|---|---|---|
| `LIVE_DATA_MODE` | Prepínač režimu servera | `elasticsearch` (namiesto `mock`) |
| `ELASTICSEARCH_URL` | Base URL clusteru | `https://elasticsearch.internal.example` |
| `ELASTICSEARCH_API_KEY` | Read-only API kľúč vo formáte `id:api_key` alebo zakódovaný base64 | *(tajomstvo, pozri sekciu 3)* |
| `ELASTICSEARCH_INDEX` | Stabilný alias/data stream, z ktorého sa čítajú Kibana eventy | `sklc3-events` |
| `PORT` | Port lokálneho servera (nesúvisí s ES, len pre úplnosť) | `5173` |

Všetky premenné sa nastavujú v `server/.env` (lokálna kópia
`server/.env.example`, ktorá sa **necommituje** do gitu).

## 3. Bezpečné uloženie API kľúča

1. Vytvor API kľúč podľa sekcie 1 a Kibana/Elasticsearch ti vráti dvojicu
   `id` a `api_key` **iba raz** — ulož ju okamžite do password manažéra
   alebo secrets manažéra (napr. Vault, 1Password, AWS/GCP Secrets
   Manager). Po zavretí okna sa `api_key` už nedá znovu zobraziť.
2. Lokálne pre vývoj: skopíruj `server/.env.example` do `server/.env` a
   doplň hodnotu. Over, že `server/.env` **nie je** sledovaný gitom
   (`git check-ignore -v server/.env`) — ak `.gitignore` v repozitári
   ešte neobsahuje `server/.env` / `.env`, nepridávaj kľúč do repozitára a
   nahlás to majiteľovi repozitára, aby `.gitignore` doplnil.
3. V produkčnom/zdieľanom prostredí nikdy neposielaj `ELASTICSEARCH_API_KEY`
   cez chat, e-mail alebo commit — používaj injektovanie premenných cez
   secrets manažér nasadzovacej platformy (napr. CI/CD secret store).
4. Kľúč pravidelne rotuj (odporúčanie: každých 90 dní alebo pri podozrení
   na únik) — starý kľúč po rotácii okamžite invaliduj cez
   `DELETE /_security/api_key`.
5. Kľúč nikdy nevkladaj do frontendového kódu (`src/`) — `server/index.mjs`
   komentár explicitne zdôrazňuje, že credentials sa nesmú dostať do
   prehliadača (`liveSnapshot()` beží iba na serveri).

## 4. Kontrolné curl príkazy

Pred spustením exportuj premenné do shellu (hodnoty dosaď z vlastného
secrets manažéra, nikdy ich nevpisuj priamo do príkazu ani do histórie
shellu v čitateľnej podobe v zdieľanom termináli):

```bash
export ELASTICSEARCH_URL="https://elasticsearch.internal.example"
export ELASTICSEARCH_API_KEY="id:api_key"      # formát podľa ES API key auth
export ELASTICSEARCH_INDEX="sklc3-events"
```

### 4.1 Over dostupnosť clusteru (bez potreby indexových práv)

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: ApiKey $(printf '%s' "$ELASTICSEARCH_API_KEY" | base64)" \
  "$ELASTICSEARCH_URL/"
```

Očakávaný výsledok: `200`.

### 4.2 Over, že kľúč vie iba čítať (nie zapisovať) do cieľového indexu

```bash
curl -s \
  -H "Authorization: ApiKey $(printf '%s' "$ELASTICSEARCH_API_KEY" | base64)" \
  "$ELASTICSEARCH_URL/$ELASTICSEARCH_INDEX/_count"
```

Očakávaný výsledok: JSON s `"count"` a bez chyby autorizácie.

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: ApiKey $(printf '%s' "$ELASTICSEARCH_API_KEY" | base64)" \
  -H "Content-Type: application/json" \
  -X POST "$ELASTICSEARCH_URL/$ELASTICSEARCH_INDEX/_doc" \
  -d '{"test": true}'
```

Očakávaný výsledok: `403 Forbidden` — ak kľúč dokáže zapísať dokument
(`201`), rola má priveľké oprávnenia a treba ju opraviť podľa sekcie 1.

### 4.3 Over, že kľúč nemá prístup mimo cieľového indexu

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: ApiKey $(printf '%s' "$ELASTICSEARCH_API_KEY" | base64)" \
  "$ELASTICSEARCH_URL/_all/_count"
```

Očakávaný výsledok: `403 Forbidden` alebo odpoveď obmedzená iba na
`ELASTICSEARCH_INDEX` (v závislosti od verzie clusteru) — nie prístup ku
všetkým indexom.

### 4.4 Ukážka dopytu na eventy podľa `agent`/`direction`

Zodpovedá štruktúre používanej v `data/sklc3-telemetry-mapping.md`
(`agent`, `direction`, `edgeId`) a udalostiam typu `Box has been routed`,
`Arm status changed`, `Message received` (pozri `server/fixtures/` pre
anonymizované príklady):

```bash
curl -s \
  -H "Authorization: ApiKey $(printf '%s' "$ELASTICSEARCH_API_KEY" | base64)" \
  -H "Content-Type: application/json" \
  "$ELASTICSEARCH_URL/$ELASTICSEARCH_INDEX/_search" \
  -d '{
    "size": 5,
    "sort": [{ "@timestamp": "desc" }],
    "query": {
      "term": {
        "messageTemplate.keyword": "Box has been routed (boxCode='{BoxCode}'; direction={DirectionTo})."
      }
    }
  }'
```

## 5. Zoznam pred nasadením do `live` režimu

- [ ] API kľúč má iba `read` + `view_index_metadata` na jednom konkrétnom
      indexe/aliase (bod 1, overené curl testom 4.2/4.3).
- [ ] `ELASTICSEARCH_URL`, `ELASTICSEARCH_API_KEY`, `ELASTICSEARCH_INDEX`
      sú nastavené v `server/.env`, nie v kóde ani v `src/`.
- [ ] `server/.env` nie je sledovaný gitom.
- [ ] Kľúč je uložený v secrets manažéri s nastaveným dátumom rotácie.
- [ ] `curl` kontrolné príkazy zo sekcie 4 boli spustené a výsledky
      zodpovedajú očakávaniam.
