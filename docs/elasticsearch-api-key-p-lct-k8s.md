# Nový read-only API kľúč pre `p-lct-k8s-*`

Tento návod je pre **budúci Variant A** (priame pripojenie appky na
Elasticsearch, bez browser extension) alebo pre prípad, že aktuálny
Variant B (`browser-extension/`, pozri `browser-extension/README.md`)
prestane stačiť. Nie je potrebný na to, aby fungoval aktuálny
`browser-extension/` — ten používa iba existujúcu session prehliadača v
Kibane, žiadny API kľúč.

## Prečo nový kľúč, nie ten existujúci

`server/.env` už obsahuje read-only kľúč `sklc3-live-readonly`, ale jeho
rola je obmedzená (inline `role_descriptors`) presne na jeden index —
`k8s-logistics-core-prd-wtmsklc3int` (pozri
`docs/kibana-live-validation.md`). Elasticsearch role restriction sa
neroz širuje automaticky na iné indexy/aliasy, takže tento kľúč **nemá**
prístup k `p-lct-k8s-*`. Treba buď nový kľúč, alebo rozšíriť existujúcu
rolu o druhý index — v oboch prípadoch krok robí niekto s právom
`manage_api_key`/`manage_security` v danom Elastic clustri.

## Variant 1 — cez Kibana Security UI (najjednoduchšie, ak máš prístup)

1. Kibana → **Stack Management → Security → API keys → Create API key**.
2. Meno: napr. `sklc3-live-logs-readonly`.
3. **Restrict privileges** → zapni, vlož presne tento `role_descriptors`
   JSON (nula cluster privileges, read-only na presne jeden index pattern):

```json
{
  "sklc3-live-logs-readonly": {
    "cluster": [],
    "indices": [
      {
        "names": ["p-lct-k8s-*"],
        "privileges": ["read", "view_index_metadata"]
      }
    ]
  }
}
```

4. Vytvor kľúč. Kibana zobrazí `id`, `api_key` a `encoded` (base64
   spojenie oboch) **iba raz** — ulož ihneď do password/secrets manažéra.
5. Over podľa `docs/elasticsearch-access-checklist.md` sekcia 4 (curl
   `_count` na `p-lct-k8s-*` má vrátiť `200`, zápis má vrátiť `403`).

## Variant 2 — cez Kibana Dev Tools Console (ak nemáš prístup do Security UI)

V `/app/dev_tools#/console` (rovnaké miesto, kde bol overený `_search`
dopyt zo zadania) spusti:

```
POST /_security/api_key
{
  "name": "sklc3-live-logs-readonly",
  "role_descriptors": {
    "sklc3-live-logs-readonly": {
      "cluster": [],
      "indices": [
        {
          "names": ["p-lct-k8s-*"],
          "privileges": ["read", "view_index_metadata"]
        }
      ]
    }
  }
}
```

Vyžaduje, aby tvoj vlastný Kibana účet mal cluster privilege
`manage_api_key` alebo `manage_own_api_key`. Ak dostaneš `403`, nemáš
oprávnenie vytvoriť kľúč sám — použi promt nižšie a pošli ho
administrátorovi Elastic/Kibana.

## Promt na poslanie administrátorovi (ak nemáš vlastné právo vytvoriť kľúč)

Skopíruj a pošli:

> Potrebujem read-only Elasticsearch API kľúč pre index pattern
> `p-lct-k8s-*` na klastri `eck-pdc1k8sobs-logging`, obmedzený inline
> rolou s `"cluster": []` a `"indices": [{"names": ["p-lct-k8s-*"],
> "privileges": ["read", "view_index_metadata"]}]` — žiadne `write`,
> `delete`, `manage` ani prístup k iným indexom. Účel: interný nástroj na
> zobrazenie live logov `tms-multi-agent`. Stačí mi `id` + `api_key`
> (alebo `encoded`), pošlite ich prosím cez [secrets manažér / heslový
> manažér, nie chat ani e-mail v čistom texte].

## Po získaní kľúča

Kľúč sa **nikdy** nevkladá do `src/` ani do `browser-extension/` — patrí
výhradne do `server/.env` (mimo gitu), rovnako ako existujúci
`ELASTICSEARCH_API_KEY`. Ak sa neskôr bude realizovať Variant A pre tento
index, pridajú sa analogické premenné (napr. `LOGS_ELASTICSEARCH_URL`/
`LOGS_ELASTICSEARCH_API_KEY`/`LOGS_ELASTICSEARCH_INDEX=p-lct-k8s-*`) do
`server/index.mjs` — mimo scope tejto úlohy, kým nebude kľúč aj sieťová
dostupnosť potvrdená.
