# jitterscope — el perfil como sismografo

## la idea central

la mayoria de las herramientas de monitoreo son reactivas: te avisan cuando algo ya se rompio. jitterscope es un sismografo digital — mide q tan caotica se esta volviendo la latencia y detecta la firma de caos ANTES de q la falla sea visible. la señal es la **entropia de shannon aplicada al jitter de latencia**: la entropia se calcula sobre el tiempo, no sobre el espacio — una sola sonda con una ventana de N mediciones ya produce señal valida.

base academica: dahmouni (2012), "an analytical model for jitter in ip networks", polytechnique montreal. el jitter estocastico como precursor de fallos es tecnica real en redes academicas y militares; shannon sobre series de tiempo de latencia es un diferenciador legitimo frente a herramientas q solo miden up/down binario.

este repo es mi perfil de github, pero tambien es la **maqueta viva de esa idea**: cada visita al perfil dispara una sonda real escrita en rust, calcula H sobre la ventana, y renderiza el resultado. no hay nada hardcodeado.

## la metrica

```
H(X) = -Σ P(xᵢ) · log₂ P(xᵢ)        normalizada x log₂(k), k=12 bins
```

valores predecibles → masa concentrada en pocos bins → H baja → red sana.
valores caoticos → masa repartida → H alta → red bajo estres.

**calibracion (importante):** los bins NO van del min al max de la ventana — van de `0.6×p50` a `1.8×p50`, anclados a la mediana. si binneas sobre el rango observado, una ventana angosta reparte el ruido normal en todos los bins y H da falso positivo. anclando al baseline, "predecible" = "cerca de lo esperado". una red puede tener jitter ALTO pero CONSTANTE (enlace saturado estable) → H baja → sana bajo carga. eso shannon lo distingue y un promedio de jitter (rfc 3550) no — esa es toda la tesis.

el indice final suma perdida de paquetes: `entropia = min(1, H·0.85 + loss·1.5)`.

**umbrales (tres calibraciones, una x instrumento):** cada entorno tiene su propio piso de ruido, asi q los colores no comparten umbral:

| instrumento | lima | ambar | rojo | xq |
|---|---|---|---|---|
| ci + web (node/navegador) | `< .40` | `.40-.62` | `> .62` | conexiones reusadas, piso bajo |
| card local (worker, 48 sondas) | `< .78` | `.78-.90` | `> .90` | cada sonda paga dns/tls → piso ≈ .75 |
| mesh (6 rounds x region) | `< .60` | `.60-.75` | `> .75` | ventana chica y ruidosa; calibrado a la distribucion real (~.45-.70) |

la regla de calibracion es siempre la misma: los umbrales abrazan la distribucion q el instrumento realmente mide — un panel q nunca cambia de color no informa.

## las 3 capas (espejo de la arquitectura del producto)

| perfil (hoy) | producto (vision) |
|---|---|
| worker rust→wasm en cloudflare, sondea http en cada vista | edge probe en rust nativo, pings udp, tui con crossterm |
| action en ci cada 6hs como fallback + historial en commits | mesh orchestrator gossip/p2p, sin servidor central |
| arena 3d q mide la conexion del visitante | dashboard local next.js |

**capa 1 — la card (`edge/`):** rust compilado a wasm. cada request: lee `config.json` del repo, tira 48 sondas http (4 hosts en paralelo, cadena secuencial x host xq el jitter es entre muestras consecutivas), shannon sobre la ventana, stats de github via graphql, svg animado. fallback: si algo falla, 302 a la card commiteada. el codigo explicado linea x linea esta en `edge/RUST_NOTES.md`.

**serve-stale (importante):** camo corta a ~4s y una medicion completa con anchors transcontinentales tarda ~6s. x eso la card servida sale de kv: cada vista responde al instante con la ULTIMA medicion y dispara una nueva en background — tu visita pinta la card q ve el proximo visitante. y un cron del worker (`edge/wrangler.toml` → `[triggers]`, cada 30 min) re-mide aunque nadie visite, asi el primero q llega despues de un dia tranquilo no ve la card de ayer.

**el mesh (dentro de la card):** 9 durable objects con location hints, uno fijado en cada region de cloudflare (wnam, enam, sam, weur, eeur, apac, oc, afr, me) — cada uno sondea los mismos targets desde su continente. los targets del mesh NO son los de la card: gh/npm/vrc son anycast, cada region recibe respuesta de un servidor al lado → rutas cortas y perfectas → H plana → verde eterno. el mesh sondea **origenes unicos** (anchors de ripe atlas: sao paulo, bangalore, johannesburgo — servidores q viven en UN solo lugar fisico) para q cada region mida una ruta de largo distinto, mas UN target anycast (cloudflare) como **control**: si el control se pone rojo, el problema es el vantage point, no la ruta. diseño experimento-con-control, no decoracion. se configura en `config.json` → `mesh_probes` (fallback: `probes`). ojo: los anchors responden solo http plano (puerto 80) — para el worker no es problema.

**capa 2 — el ci (`scripts/generate.mjs`):** mismo pipeline en node, corre cada 6hs, commitea `assets/card.svg` + `assets/telemetry.json`. respaldo del worker y serie historica gratis en los commits.

**capa 3 — el sitio (`web/`):** `https://nstefoni.github.io/nstefoni/` mide la conexion DEL VISITANTE desde su navegador. es un dashboard de deteccion temprana estilo USGS: banner de alerta, helicorder con los 4 canales (canvas 2d, scroll continuo anclado al reloj), gauge de shannon, event feed, traza historica persistente (localStorage), y un panel 3d con tres vistas de la misma señal — waterfall (la distribucion como terreno en el tiempo), chamber (la entropia como particulas: rio laminar ↔ gas caotico) y highway (cada auto = un paquete real, el espaciado = jitter, con car-following → embotellamientos reales). controles: toggle x canal, rate segmentado q gobierna sondas Y trafico, switch de inject fault (persistente), camara libre en el 3d (drag/zoom/dblclick). helpers "?" en cada panel.

ojo: en cloudflare workers y en navegador NO hay udp — se mide rtt de http. el mvp real (udp + tui) es otro binario y otro repo; este perfil es la maqueta conceptual.

## paleta: acid

fondo carbon neutro `#191c1e` + tinta `#e9ede2` + un solo acento lima `#c8f04c`. la logica: en un instrumento el color es informacion, no decoracion — el fondo neutro deja toda la energia cromatica para la señal. semantica: lima (sano) → ambar → rojo. otras paletas listas en `config.json` → `themes` (daydream, klein, riso, espresso); cambiar = editar `"theme"`.

## donde se toca cada cosa

| quiero cambiar | toco |
|---|---|
| textos, about, stack | `config.json` (el worker lo levanta solo en ~10 min) |
| paleta | `config.json` → `"theme"` |
| hosts o cantidad de sondas | `config.json` → `probes` / `rounds` |
| targets del mesh regional | `config.json` → `mesh_probes` (1 control anycast + origenes unicos) |
| cron del ci (card fallback commiteada) | `.github/workflows/update-banner.yml` |
| cron del worker (kv tibio, cada 30 min) | `edge/wrangler.toml` → `[triggers]` |
| la metrica / el dibujo | `edge/src/lib.rs` y `scripts/generate.mjs` — son GEMELOS, tocar ambos |
| la arena 3d | `web/index.html` |

`web/theme.css` lo genera el ci desde el config — no editarlo a mano.

## deploy

```bash
# worker (rust):
cd edge && npx wrangler deploy
gh auth token | npx wrangler secret put GITHUB_TOKEN   # para el stat CONTRIB

# regenerar card local:
node scripts/generate.mjs
THEME=klein OUT_DIR=preview node scripts/generate.mjs  # probar paleta sin pisar nada
```

free tier de cloudflare: 100k req/dia, 50 subrequests x req. la card usa ~50. costo: $0.

## troubleshooting

- **card vieja al refrescar** → cache de camo (proxy de imagenes de github); con `no-store` refresca, sino sumar `?v=N` al src
- **worker da ssl error** → subdominio workers.dev recien creado, el cert tarda minutos
- **action sin permisos** → settings → actions → general → read and write permissions
- **CONTRIB no aparece** → falta el secret `GITHUB_TOKEN` del worker
- **mesh todo rojo de golpe** → probablemente un anchor muerto: un host caido mete loss≈.25 en las 9 regiones (`curl http://br-sao-as22548.anchors.atlas.ripe.net/` para chequear). swap del anchor en `config.json` → `mesh_probes` — el worker lo levanta solo, sin redeploy. lista de reemplazo: atlas.ripe.net/anchors
- **mesh todo verde x meses** → el control (CF) deberia estar SIEMPRE verde; si los origenes unicos tambien, o la red mundial anda perfecta o los umbrales quedaron flojos — recalibrar contra `telemetry.json`
- **compilar rust falla** → `rustup target add wasm32-unknown-unknown` y `cargo install worker-build`

## proximo paso (otro repo)

el mvp real de jitterscope: loop de pings udp midiendo rtt, ventana deslizante, shannon, tui con crossterm y umbrales verde/amarillo/rojo. stack: rust + tokio + clap + crossterm + hdrhistogram. la funcion `shannon()` de este repo (con su calibracion al baseline) se porta tal cual.
