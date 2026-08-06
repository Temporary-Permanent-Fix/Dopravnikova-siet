# Editor dopravníkové sítě

Desktopový nástroj (Tauri 2) na editáciu layoutu dopravníkovej / triediacej
siete — uzly a hrany naprieč podlažiami skladu, s optimalizáciou cez LP solver.

Verzia obnovená zo skompilovaného buildu **0.3.2-BETA**. Detaily obnovy: `RECOVERY-README.md`.

## Štruktúra

    src/                     front-end (Tauri frontendDist)
      index.html             celá appka (HTML + CSS + JS v jednom súbore)
      tauri-integration.js   stub (pôvodný IPC glue sa neobnovil celý)
      assets/
        alza_cz.png          logo (obnovené)
        fonts/               IBM Plex + Tabler Icons (vendorované z npm, viď README vnútri)
      highs/build/           HiGHS wasm (vendorované z npm, viď README vnútri)
    data/
      data.json              pôvodný obnovený dataset CZLC4 (len historická referencia)
      sklc3.json             oficiálny lokálny layout SKLC3
    _recovered/              čiastočne obnovené súbory len pre referenciu

## Solver

- Primárny: **HiGHS** (WASM, beží vo Web Workeri z inline blobu) — súbory v `src/highs/build/`.
- Fallback: **glpk.js** (GLPK) — načítava sa z CDN `https://esm.sh/glpk.js@4.0.2`.

## Dáta

Appka si stav ukladá do `localStorage`. Tlačidlo **Načítať SKLC3** načíta lokálny
`src/sklc3.json` a nevyžaduje internet ani GitHub token. Súbor je zatiaľ prázdna,
platná šablóna; nahraď ho dodaným layoutom SKLC3. `data/data.json` obsahuje
pôvodný CZLC4 dataset len ako historickú referenciu.

## Ako rozbehať (Tauri 2)

Front-end je čisté HTML/JS, takže na náhľad stačí ľubovoľný static server:

    cd src && python3 -m http.server 5173   # http://localhost:5173

Pre plný desktop build treba doplniť Tauri obal:

1. `npm create tauri-app@latest` → vanilla, TypeScript nie je nutný, Tauri **v2**.
2. Nastav `frontendDist` na tento `src/` (alebo skopíruj obsah).
3. V `tauri.conf.json` zapni `app.withGlobalTauri: true` a pluginy
   (fs, dialog, event, window, webview, menu, tray, path, image).
4. Doplň fonty a HiGHS wasm (viď READMEs v priečinkoch).
5. `npm run tauri dev`.

## Backend

Rust backend (`src-tauri/`) sa z `.exe` obnoviť nedal (skompilovaný strojový kód).
Keďže appka je hlavne webview wrapper, dá sa dopísať nanovo podľa použitých pluginov vyššie.

## Windows inštalátor (bez Tauri)

Kým plný Tauri build nie je hotový, appku je možné nainštalovať na Windows
ako lokálny web server (bez závislostí) cez skripty v `windows-installer/`
— pozri `windows-installer/README.md`.
