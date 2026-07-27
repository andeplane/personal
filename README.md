# personal

Personlige småprosjekter, publisert med GitHub Pages → **https://andeplane.github.io/personal/**

Rene statiske filer. Ingen byggesteg, ingen rammeverk — `git push` til `main` deployer.

## Struktur

```
index.html              landingssiden (bloggen, år for år)
assets/style.css        felles stil
assets/shots/           skjermbilder til postkortene
posts/<år>-<navn>/      én mappe per post
.github/workflows/      Pages-deploy
```

## Legge til en ny post

1. Lag mappa: `posts/2026-noe/` med en `index.html` inni.
2. Ta et skjermbilde og legg det i `assets/shots/noe.jpg`:
   ```sh
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
     --headless --disable-gpu --hide-scrollbars --virtual-time-budget=6000 \
     --window-size=1440,900 --screenshot=assets/shots/noe.png \
     "file://$PWD/posts/2026-noe/index.html"
   sips -Z 1200 --setProperty formatOptions 68 --setProperty format jpeg \
     assets/shots/noe.png --out assets/shots/noe.jpg && rm assets/shots/noe.png
   ```
3. Kopier en `<article class="post">`-blokk i `index.html`, bytt tekst, bilde og lenke.
   Nytt år? Legg til en ny `<section class="year">` øverst.
4. `git push` — Pages deployer automatisk.

Posten kan like gjerne peke til et annet repo eller en ekstern side; kortet trenger bare
en lenke. Tåsen ligger for eksempel i [andeplane/taasen](https://github.com/andeplane/taasen)
og lenkes bare til herfra.
