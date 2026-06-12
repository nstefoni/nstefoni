<div align="center">

<a href="https://nstefoni.github.io/nstefoni/"><img src="https://jitterscope.nstefoni.workers.dev/card.svg" width="880" alt="Nicolas Stefoni — software developer, Buenos Aires. Live network jitter rendered at request time: every view of this profile triggers a fresh measurement from Cloudflare's edge. I ship product end to end — mobile (React Native · Expo) and web (Next.js). Stack: TypeScript, React Native, Next.js, Node.js, GraphQL."/></a>

<br/>

<sub><code>rendered on request: rust on cloudflare's edge probing 4 targets from 9 regions — shannon entropy over the rtt window</code></sub>

<sub><code>want YOUR connection measured? → <a href="https://nstefoni.github.io/nstefoni/">open the live jitterscope ↗</a></code></sub>

</div>

<details>
<summary><code>■ how does this work? · english</code></summary>
<br/>

> most monitoring is reactive: it tells you when something already broke. **jitterscope** is a digital seismograph — it measures how chaotic latency is *becoming*, and detects the signature of chaos before failure is visible.

the metric is **shannon entropy over the rtt window**: `H(X) = -Σ P(xᵢ)·log₂P(xᵢ)`, normalized 0–1. in plain words: latency has a rhythm. on a healthy connection every probe comes back in roughly the same time, so the histogram piles into a few bins → low H. under stress the times scatter all over → H climbs toward 1. and the rhythm gets messy *before* packets actually drop — entropy is the leading indicator, downtime is the lagging one.

four layers, each running somewhere different:

**layer 1 — the card** ([edge/](edge/), rust→wasm). when someone opens this profile, the README image points — through camo, github's image proxy — at a cloudflare worker. rust compiled to webassembly wakes up: it reads `config.json` from the repo, fires 48 http probes — 4 hosts in parallel, a sequential chain per host, because jitter lives between consecutive samples — computes shannon over the window, pulls github stats via graphql, and draws the animated svg. a full measurement takes longer than camo's patience, so the worker serves the last rendered card instantly (kv-backed) and re-measures in the background: your view paints the card the next visitor sees. a cron re-measures every 30 minutes, so the card stays fresh even with zero visitors. if everything fails, it 302s to the committed card. the natural intuition is that there are nodes measuring all the time: no — the measurement is born when someone looks.

**layer 2 — the mesh** (durable objects). the same probe runs in parallel from 9 cloudflare regions — one durable object pinned to each by location hint. the mesh doesn't probe the card's targets: those are anycast, every region gets answered by a server next door and the map stays flat. instead it probes single-origin ripe atlas anchors — são paulo, bangalore, johannesburg, servers that live in ONE physical place — so each region measures a route of a different length, plus one anycast control (cloudflare): if the control goes red, suspect the vantage point, not the route. every region computes its own H and paints its slice of the world map; together they feed the pooled trend. nine seismographs, one reading.

**layer 3 — the ci** ([scripts/generate.mjs](scripts/generate.mjs), node). the same pipeline rewritten in javascript runs every 6 hours as a github action and commits `assets/card.svg` + telemetry — it's the worker's fallback, and as a bonus the historical series lives in the commit log. they're twins: touch the metric in one, you touch it in the other.

**layer 4 — the site** ([web/](web/), your browser). the page at github.io measures the visitor's own connection: a 4-channel helicorder, a shannon gauge, an event feed and the 3d panel. your connection, recorded and exportable.

one note of technical honesty: there's no udp in workers nor in the browser — what's measured here is http rtt. the real thing, with udp pings, sliding window and a tui, is being built in rust at [nstefoni/jitterscope](https://github.com/nstefoni/jitterscope); the profile is the concept model.

docs: [how it works](SETUP.md) · [the rust explained line by line](edge/RUST_NOTES.md) · [design system](web/DESIGN.md)

</details>

<details>
<summary><code>■ ¿cómo funciona esto? · español</code></summary>
<br/>

> la mayoría del monitoreo es reactivo: te avisa cuando algo ya se rompió. **jitterscope** es un sismógrafo digital — mide qué tan caótica se está *volviendo* la latencia, y detecta la firma del caos antes de que la falla sea visible.

la métrica es **entropía de shannon sobre la ventana de rtt**: `H(X) = -Σ P(xᵢ)·log₂P(xᵢ)`, normalizada 0–1. en criollo: la latencia tiene un ritmo. con la conexión sana cada probe vuelve en más o menos el mismo tiempo, el histograma se apila en pocos bins → H baja. bajo estrés los tiempos se desparraman → H trepa hacia 1. y el ritmo se ensucia *antes* de que se pierdan paquetes — la entropía es el indicador adelantado, el downtime es el atrasado.

son cuatro capas, y cada una corre en un lugar distinto:

**capa 1 — la card** ([edge/](edge/), rust→wasm). cuando alguien abre este perfil, la imagen del README apunta — vía camo, el proxy de imágenes de github — a un worker de cloudflare. ahí se despierta rust compilado a webassembly: lee `config.json` del repo, tira 48 sondas http — 4 hosts en paralelo, cadena secuencial por host, porque el jitter vive entre muestras consecutivas — calcula shannon sobre la ventana, levanta los stats de github vía graphql y dibuja el svg animado. la medición completa tarda más que la paciencia de camo, así que el worker sirve al instante la última card renderizada (persistida en kv) y re-mide en background: tu visita pinta la card que ve el próximo visitante. un cron re-mide cada 30 minutos, así la card queda fresca aunque nadie visite. si todo falla, hace un 302 a la card commiteada. la intuición natural sería que hay nodos midiendo todo el tiempo: no — la medición nace cuando alguien mira.

**capa 2 — el mesh** (durable objects). el mismo probe corre en paralelo desde 9 regiones de cloudflare — un durable object fijado en cada una por location hint. el mesh no sondea los targets de la card: esos son anycast, a cada región le responde un servidor al lado y el mapa queda plano. sondea **orígenes únicos** — anchors de ripe atlas en são paulo, bangalore y johannesburgo, servidores que viven en UN solo lugar físico — para que cada región mida una ruta de largo distinto, más un control anycast (cloudflare): si el control se pone rojo, el problema es el vantage point, no la ruta. cada región calcula su propia H y pinta su pedazo del mapa; juntas alimentan la tendencia agregada. nueve sismógrafos, una lectura.

**capa 3 — el ci** ([scripts/generate.mjs](scripts/generate.mjs), node). el mismo pipeline reescrito en javascript corre cada 6 horas como github action y commitea `assets/card.svg` + telemetría — es el respaldo del worker, y de paso la serie histórica queda en el log de commits. son gemelos: tocás la métrica en uno, la tocás en el otro.

**capa 4 — el sitio** ([web/](web/), tu navegador). la página en github.io mide la conexión del propio visitante: helicorder de 4 canales, gauge de shannon, event feed y el panel 3d. tu conexión, grabada y exportable.

un detalle de honestidad técnica: ni en workers ni en el navegador hay udp — acá se mide rtt de http. lo de verdad, con pings udp, sliding window y tui, se está construyendo en rust en [nstefoni/jitterscope](https://github.com/nstefoni/jitterscope); el perfil es la maqueta conceptual.

docs: [cómo funciona](SETUP.md) · [el rust explicado línea por línea](edge/RUST_NOTES.md) · [design system](web/DESIGN.md)

</details>
