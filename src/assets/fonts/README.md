# Fonty (doplněno)

Vendorováno z npm (`@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`,
`@tabler/icons-webfont`) — offline, žádné CDN volání.

- `ibm-plex-sans-{400,500,600}-{latin,latinext}.woff2` — IBM Plex Sans, latin +
  latin-ext (diakritika CS/SK). Dva soubory na váhu, rozlišené `unicode-range`
  v `index.html`, prohlížeč stáhne/použije jen to, co potřebuje.
- `ibm-plex-mono-{400,500}-{latin,latinext}.woff2` — totéž pro IBM Plex Mono.
- `tabler-icons.min.css` + `tabler-icons.{woff2,woff,ttf}` — Tabler Icons
  webfont (verze 3.45.0; pár ikon z originálního buildu bylo v mezičase
  přejmenováno/odebráno proti starší verzi, viz `ti-player-play-filled` →
  `ti-player-play` v `index.html`).

Licence: IBM Plex — SIL OFL 1.1. Tabler Icons — MIT. Viz balíčky na npm.
