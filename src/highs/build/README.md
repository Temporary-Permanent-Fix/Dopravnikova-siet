# HiGHS solver (chýba — third-party, doplň sem)

`index.html` načítava primárny solver z tohto priečinka:

- `highs.js`
- `highs.wasm`

Zdroj: HiGHS WebAssembly build — https://github.com/lovasoa/highs-js
(napr. `npm i highs`, skopíruj `build/highs.js` a `build/highs.wasm` sem).

Fallback solver glpk.js sa načítava z CDN (`https://esm.sh/glpk.js@4.0.2`), netreba nič lokálne.
