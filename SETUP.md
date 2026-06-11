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
umbrales: `< .40` lima (nominal) · `.40-.62` ambar (subiendo) · `> .62` rojo (degradacion probable).

## las 3 capas (espejo de la arquitectura del producto)

| perfil (hoy) | producto (vision) |
|---|---|
| worker rust→wasm en cloudflare, sondea http en cada vista | edge probe en rust nativo, pings udp, tui con crossterm |
| action en ci cada 6hs como fallback + historial en commits | mesh orchestrator gossip/p2p, sin servidor central |
| arena 3d q mide la conexion del visitante | dashboard local next.js |

**capa 1 — la card (`edge/`):** rust compilado a wasm. cada request: lee `config.json` del repo, tira 48 sondas http (4 hosts en paralelo, cadena secuencial x host xq el jitter es entre muestras consecutivas), shannon sobre la ventana, stats de github via graphql, svg animado. fallback: si algo falla, 302 a la card commiteada. el codigo explicado linea x linea esta en `edge/RUST_NOTES.md`.

**capa 2 — el ci (`scripts/generate.mjs`):** mismo pipeline en node, corre cada 6hs, commitea `assets/card.svg` + `assets/telemetry.json`. respaldo del worker y serie historica gratis en los commits.

**capa 3 — el sitio (`web/`):** `https://nstefoni.github.io/nstefoni/` mide la conexion DEL VISITANTE desde su navegador. arena 3d: 4 anillos osciloscopio (uno x host), nucleo de entropia q late en el centro, sweep de radar escribiendo muestras, estratos q se hunden con la historia (color = salud de ese momento). orbita 360 con drag, zoom con scroll.

ojo: en cloudflare workers y en navegador NO hay udp — se mide rtt de http. el mvp real (udp + tui) es otro binario y otro repo; este perfil es la maqueta conceptual.

## paleta: acid

fondo carbon neutro `#191c1e` + tinta `#e9ede2` + un solo acento lima `#c8f04c`. la logica: en un instrumento el color es informacion, no decoracion — el fondo neutro deja toda la energia cromatica para la señal. semantica: lima (sano) → ambar → rojo. otras paletas listas en `config.json` → `themes` (daydream, klein, riso, espresso); cambiar = editar `"theme"`.

## donde se toca cada cosa

| quiero cambiar | toco |
|---|---|
| textos, about, stack | `config.json` (el worker lo levanta solo en ~10 min) |
| paleta | `config.json` → `"theme"` |
| hosts o cantidad de sondas | `config.json` → `probes` / `rounds` |
| frecuencia del cron | `.github/workflows/update-banner.yml` |
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
- **compilar rust falla** → `rustup target add wasm32-unknown-unknown` y `cargo install worker-build`

## proximo paso (otro repo)

el mvp real de jitterscope: loop de pings udp midiendo rtt, ventana deslizante, shannon, tui con crossterm y umbrales verde/amarillo/rojo. stack: rust + tokio + clap + crossterm + hdrhistogram. la funcion `shannon()` de este repo (con su calibracion al baseline) se porta tal cual.
