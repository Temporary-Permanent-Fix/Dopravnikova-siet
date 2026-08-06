# Windows inštalátor

Tento priečinok obsahuje inštalátor pre appku **Dopravníková sieť**
(SKLC3 live visualization) na Windows. Appka beží ako lokálny Node.js server
bez závislostí (statický frontend + `server/index.mjs`), takže inštalátor ju
len skopíruje na disk, doinštaluje Node.js (ak chýba) a vytvorí odkazy na
spustenie. K dispozícii sú dva rovnocenné spôsoby:

## Možnosť A — jeden `.exe` inštalátor (odporúčané)

**`dist/DopravnikovaSietSetup.exe`** je skutočný skompilovaný Windows
inštalátor (NSIS) — grafický wizard, výber priečinka, odkaz na ploche a v
Štart menu, položka v "Pridať alebo odobrať programy" s odinštalátorom.

1. Skopíruj `dist/DopravnikovaSietSetup.exe` na Windows počítač.
2. Dvojklikni a prejdi wizardom (inštaluje sa per-user do
   `%LOCALAPPDATA%\DopravnikovaSiet`, nevyžaduje admin práva).
3. Ak appka nenájde Node.js, wizard ponúkne otvoriť nodejs.org na stiahnutie —
   Node.js treba nainštalovať manuálne pred prvým spustením appky.
4. Na konci wizardu môžeš appku rovno spustiť — otvorí sa v predvolenom
   prehliadači na `http://127.0.0.1:5173`.

### Prebuild inštalátora (po zmene `src/`/`server/`/`data/`)

Inštalátor treba prekompilovať po každej zmene obsahu appky:

```
sudo apt install nsis   # ak este nie je nainstalovany
cd windows-installer
makensis DopravnikovaSiet.nsi
```

Výstup: `windows-installer/dist/DopravnikovaSietSetup.exe`.

## Možnosť B — skripty (bez potreby NSIS)

Ak nechceš pracovať s `.exe`, rovnaký výsledok dá aj skriptová verzia:

1. Skopíruj/stiahni celý repozitár na Windows počítač.
2. V priečinku `windows-installer` dvojklikni na **`Install-DopravnikovaSiet.bat`**.
3. Skript:
   - overí, či je nainštalovaný Node.js — ak nie, skúsi ho doinštalovať cez
     `winget`, prípadne stiahne oficiálny inštalátor z nodejs.org,
   - skopíruje `src/`, `server/` a `data/` do
     `%LOCALAPPDATA%\DopravnikovaSiet`,
   - vytvorí spúšťací `start-app.bat` v inštalačnom priečinku,
   - vytvorí odkaz na ploche a v Štart menu s názvom **Dopravníková sieť**.
4. Odinštalovanie: dvojklikni na **`Uninstall-DopravnikovaSiet.bat`**.

Skripty vyžadujú PowerShell 5+ (súčasť Windows 10/11) a spúšťajú sa s
`-ExecutionPolicy Bypass` len pre daný proces, natrvalo nič nemenia.

## Spoločné poznámky

- Appka pri prvom spustení beží v **mock režime** (demo dáta, žiadne
  prihlasovacie údaje netreba). Pre napojenie na živé dáta z
  Elasticsearch/Kibana over `%LOCALAPPDATA%\DopravnikovaSiet\server\.env`
  podľa vzoru `server/.env.example` v repozitári.
- Toto **nie je** Tauri desktop build (pozri hlavný `README.md` — Rust
  backend z pôvodného `.exe` sa nepodarilo obnoviť). Ide o odľahčenú
  alternatívu: appka beží ako lokálny web server otváraný v prehliadači.
