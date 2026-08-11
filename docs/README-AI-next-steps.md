# SKLC3 – referenčné príklady Kibana eventov

Reálne (ručne sanitizované) príklady troch typov Kibana eventov, ktoré
`src/live-events.mjs` (a `docs/telemetry-mapping-audit.md`) normalizuje na
`agent`/`direction`/`edgeId`. Slúžia ako doslovný zdroj pre fixture súbory v
`server/fixtures/` (pozri `server/fixtures/README.md`).

Nižšie uvedené JSON ukážky boli ručne vytiahnuté z Kibany (tab *TMS - LCT
Data for API*), po jednom dokumente z každého typu, a boli sanitizované —
odstránené boli interné infraštruktúrne polia (`master_url`, `pod_ip`,
`host`, `container_image` a pod.). Zostali len polia potrebné na
pochopenie štruktúry správy a mapovania na `agent`/`direction`/`edgeId`.

## Reálne sanitizované príklady Kibana eventov

### 1. `Box has been routed`

```json
{
  "message": "Box has been routed (boxCode='\"80051959\"'; direction=12).",
  "messageTemplate": "Box has been routed (boxCode='{BoxCode}'; direction={DirectionTo}).",
  "messageKeys": ["BoxCode", "DirectionTo"],
  "messageParams": { "BoxCode": "\"80051959\"", "DirectionTo": "12" },
  "level": "INFO",
  "logger": "RUR.TMS.Agent.Core.Routing.Components.PublishKoRoutedComponent",
  "headers": { "x-AgentName": "DS24S26" }
}
```

- `headers["x-AgentName"]` = agent (diverter), zodpovedá hlavičkám sekcií
  v `data/sklc3-telemetry-mapping.md` (napr. `DS24S26`).
- `messageParams.DirectionTo` = smer, párovaný s `agent` na `edgeId` cez
  `src/sklc3-telemetry.json` (`"DS24S26:12"` → `e66`).
- `messageParams.BoxCode` = identifikátor boxu (v `server` mocku
  zodpovedá poľu `boxCode`).

### 2. `Message received`

```json
{
  "message": "Message received (messageId=\"e943bbf4-02a0-4864-be57-fa35cdc9f9d1\"; clientId=\"OBIWAN-01\"; topic=\"rur/plc/OBIWAN/occupation\";)",
  "messageTemplate": "Message received (messageId={Id}; clientId={ClientId}; topic={Topic};)",
  "messageKeys": ["Id", "ClientId", "Topic"],
  "messageParams": {
    "Id": "\"e943bbf4-...\"",
    "ClientId": "\"OBIWAN-01\"",
    "Topic": "\"rur/plc/OBIWAN/occupation\""
  },
  "level": "INFO",
  "logger": "RUR.Common.Mqtt.Mediator.Behaviors.LogMqttMessageProcessingBehavior",
  "headers": { "x-AgentName": "OBIWAN" }
}
```

- `messageParams.Topic` má tvar `rur/plc/<AGENT>/<kategória>` — tu
  `occupation`. Toto môže byť užitočné na filtrovanie/rozlíšenie
  podtypov `Message received` eventov bez `direction`/`edgeId`.
- `headers["x-AgentName"]` opäť zodpovedá agentovi z layoutu (`OBIWAN`).

### 3. `Arm status changed`

```json
{
  "message": "Arm status changed (\"0:Occupied,6:Open,9:Open,12:Occupied\")",
  "messageTemplate": "Arm status changed ({Arms})",
  "messageKeys": ["Arms"],
  "messageParams": { "Arms": "\"0:Occupied,6:Open,9:Open,12:Occupied\"" },
  "level": "DEBUG",
  "logger": "RUR.TMS.Agent.Core.Controller.ArmStatus.BinaryArmStatusService",
  "headers": { "x-AgentName": "OBIWAN" }
}
```

- `messageParams.Arms` je CSV zoznam `<direction>:<status>` dvojíc pre
  daného agenta (`headers["x-AgentName"]`). Stavy pozorované v ukážke:
  `Occupied`, `Open`.

Pripomienka: nikdy neukladať API kľúč ani interné URL do repozitára.
