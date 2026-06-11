# jitterscope profile — docs

mi perfil de github no es una imagen, es un instrumento. cada vez q alguien lo abre, un worker en cloudflare sale a medir la red en ese momento y dibuja la card con esos datos. nada esta hardcodeado: la latencia es real, el jitter es real, la entropia es real, y mis stats de github tambien.

## como funciona (las 3 capas)

**1. la card del readme — tiempo real x visita**
el readme apunta a `https://jitterscope.nstefoni.workers.dev/card.svg`. ese worker, en cada request:
- lee `config.json` del repo (cache 10 min) — o sea q si toco el config, la card cambia sola
- tira 48 sondas http (12 rondas x 4 endpoints: github, npm, cloudflare, vercel) desde el edge
- calcula jitter (rfc 3550) + perdida → indice de entropia 0-1
- pide mis stats a la api de github (contrib del año via graphql con token, repos publicos sin token; cache 10 min para no quemar rate limit)
- renderiza el svg animado completo y lo devuelve con `cache-control: no-store` para q el proxy de imagenes de github (camo) no lo congele

si el worker explota x lo q sea, hace redirect 302 a `assets/card.svg`, q es la version commiteada x el ci. nunca se ve un perfil roto.

**2. el cron de actions — fallback + historia**
`.github/workflows/update-banner.yml` corre cada 6hs (y a mano desde la pestaña actions). hace lo mismo q el worker pero desde el runner de ci, y commitea `assets/card.svg` + `assets/telemetry.json`. sirve de respaldo y de paso queda un historial de mediciones en los commits.

**3. el sitio — jitterscope en vivo**
`https://nstefoni.github.io/nstefoni/` mide la conexion DEL VISITANTE desde su navegador. es una arena 3d en three.js: 4 anillos osciloscopio (uno x probe), un nucleo de entropia q late en el centro, y un sweep de radar q va escribiendo las muestras. se puede orbitar 360 con drag, zoom con scroll, y si lo dejas quieto rota solo. a mas entropia: el nucleo tiembla, aparecen anillos fantasma rojos, y la camara vibra.

## la entropia, q es

`entropia = 0.12 + 0.55 * (J / (J + 45)) + perdida * 1.4` (clampeado a 1)

donde J es el jitter suavizado estilo rfc 3550: `J += (|muestra - anterior| - J) / 16`. la idea de fondo es la misma q jitterscope: la varianza escala ANTES q la perdida de paquetes. el desorden es el leading indicator, la caida es el lagging.

- `.10-.40` naranja suave → señal sana
- `.40-.62` ambar → entropia subiendo
- `.62+` rojo → degradacion probable

## donde se toca cada cosa

| quiero cambiar | toco |
|---|---|
| textos, about, stack, taglines | `config.json` (el worker lo levanta solo en ~10 min) |
| tema de color | `config.json` → `"theme": "daydream"` o `"espresso"` |
| agregar un tema | `config.json` → `themes` (bg, ink, dim, accent, alert, ghosts...) |
| endpoints o cantidad de sondas | `config.json` → `probes` / `rounds` |
| frecuencia del cron | `.github/workflows/update-banner.yml` → `cron` |
| el dibujo de la card | `scripts/generate.mjs` (ci) y `edge/worker.js` (edge) — ojo q son gemelos, si tocas uno toca el otro |
| la arena 3d | `web/index.html` |

ojo: el tema del sitio vive en `web/theme.css` y lo regenera `generate.mjs` desde el config. no editarlo a mano q se pisa.

## deploy del worker

```bash
cd edge
npx wrangler deploy
# token para el stat de CONTRIB (opcional pero piola):
gh auth token | npx wrangler secret put GITHUB_TOKEN
```

el free tier de cloudflare banca 100k requests/dia y 50 subrequests x request. la card usa ~50 sondas + 1 a github. un perfil recibe cientos de vistas al dia, estamos a años luz del limite. costo: $0.

## regenerar local

```bash
node scripts/generate.mjs                    # tema activo → assets/
THEME=espresso OUT_DIR=assets-x node scripts/generate.mjs   # probar otro tema sin pisar nada
```

## troubleshooting

- **la card no se actualiza al refrescar** → es el cache de camo (proxy de imagenes de github). con `no-store` deberia refrescar siempre; si no, agregale `?v=N` al src en el readme
- **el worker da error ssl** → si el subdominio workers.dev es nuevo, el certificado tarda unos minutos. esperar y reintentar
- **la action falla con permisos** → settings → actions → general → workflow permissions → read and write
- **CONTRIB no aparece** → falta el secret `GITHUB_TOKEN` en el worker (comando arriba)
- **el sitio no carga la escena** → es un import de three.js desde esm.sh, revisar consola; el resto del sitio (hud, stats) funciona igual sin webgl

## estructura

```
config.json                  textos, stack, sondas, temas — la unica fuente de verdad
scripts/generate.mjs         sondas desde ci → card.svg + telemetry.json + web/theme.css
edge/worker.js               la misma card pero renderizada x request en cloudflare
edge/wrangler.toml           config del worker
web/index.html               la arena 3d q mide al visitante
web/theme.css                paleta del sitio (generado, no tocar)
assets/card.svg              fallback commiteado x el ci
assets/telemetry.json        ultima medicion cruda, x si quiero graficar historia
.github/workflows/           cron de telemetria + deploy de pages
```
