# HiGHS solver (doplněno)

`highs.js` + `highs.wasm` vendorováno z npm balíčku `highs` (1.15.2, build
https://github.com/lovasoa/highs-js) — appka tak řeší LP/MILP offline, bez
CDN. Fallback na `https://cdn.jsdelivr.net/npm/highs/build/` a na glpk.js
(CDN) zůstává funkční, pokud tyto soubory chybí nebo selžou.

Licence: MIT.
