<div align="center">

<a href="https://nstefoni.github.io/nstefoni/"><img src="https://jitterscope.nstefoni.workers.dev/card.svg" width="880" alt="Nicolas Stefoni — software developer, Buenos Aires. Live network jitter rendered at request time: every view of this profile triggers a fresh measurement from Cloudflare's edge. I ship product end to end — mobile (React Native · Expo) and web (Next.js). Stack: TypeScript, React Native, Next.js, Node.js, GraphQL."/></a>

<br/>

<sub><code>rendered on request: rust on cloudflare's edge probing 4 targets — shannon entropy over the rtt window</code></sub>

<sub><code>want YOUR connection measured? → <a href="https://nstefoni.github.io/nstefoni/">open the live jitterscope ↗</a></code></sub>

</div>

<details>
<summary><code>■ how does this work? · english</code></summary>
<br/>

> most monitoring is reactive: it tells you when something already broke. **jitterscope** is a digital seismograph — it measures how chaotic latency is *becoming*, and detects the signature of chaos before failure is visible.

the metric is **shannon entropy over the rtt window**: `H(X) = -Σ P(xᵢ)·log₂P(xᵢ)`, normalized 0–1. predictable latency concentrates in few bins → low H → healthy. erratic latency spreads across bins → high H → stress signature. variance climbs *before* packet loss — entropy is the leading indicator, downtime is the lagging one.

this card is not an image — it's an instrument. every view triggers a [rust worker](edge/) on cloudflare's edge that fires 48 real http probes at 4 targets (github · npm · cloudflare · vercel), computes H over the window, pulls live github stats, and renders this svg on the spot. served stale-while-revalidate so it loads instantly; the timestamp tells you when the probes ran.

three layers, one idea:

| layer | where | measures |
|---|---|---|
| this card | rust→wasm on cloudflare workers, per view | edge → 4 public targets |
| [live dashboard](https://nstefoni.github.io/nstefoni/) | your browser | **your own connection**, recorded + exportable |
| [ci fallback](.github/workflows/) | github actions, cron 6h | runner → targets, committed history |

the real thing — udp probes, sliding window, tui — is being built in rust at [nstefoni/jitterscope](https://github.com/nstefoni/jitterscope). docs: [how it works](SETUP.md) · [the rust explained line by line](edge/RUST_NOTES.md) · [design system](web/DESIGN.md)

</details>

<details>
<summary><code>■ ¿cómo funciona esto? · español</code></summary>
<br/>

> la mayoría del monitoreo es reactivo: te avisa cuando algo ya se rompió. **jitterscope** es un sismógrafo digital — mide qué tan caótica se está *volviendo* la latencia, y detecta la firma del caos antes de que la falla sea visible.

la métrica es **entropía de shannon sobre la ventana de rtt**: `H(X) = -Σ P(xᵢ)·log₂P(xᵢ)`, normalizada 0–1. la latencia predecible se concentra en pocos bins → H baja → saludable. la latencia errática se dispersa entre bins → H alta → firma de estrés. la varianza sube *antes* que la pérdida de paquetes — la entropía es el indicador adelantado, el downtime es el atrasado.

esta card no es una imagen — es un instrumento. cada visita dispara un [worker en rust](edge/) en el edge de cloudflare que lanza 48 probes http reales contra 4 targets (github · npm · cloudflare · vercel), calcula H sobre la ventana, trae stats de github en vivo y renderiza este svg en el momento. se sirve stale-while-revalidate así carga instantáneo; el timestamp te dice cuándo corrieron los probes.

tres capas, una idea:

| capa | dónde | mide |
|---|---|---|
| esta card | rust→wasm en cloudflare workers, por visita | edge → 4 targets públicos |
| [dashboard en vivo](https://nstefoni.github.io/nstefoni/) | tu navegador | **tu propia conexión**, grabada + exportable |
| [fallback de ci](.github/workflows/) | github actions, cron cada 6h | runner → targets, historial commiteado |

lo de verdad — probes udp, sliding window, tui — se está construyendo en rust en [nstefoni/jitterscope](https://github.com/nstefoni/jitterscope). docs: [cómo funciona](SETUP.md) · [el rust explicado línea por línea](edge/RUST_NOTES.md) · [design system](web/DESIGN.md)

</details>
