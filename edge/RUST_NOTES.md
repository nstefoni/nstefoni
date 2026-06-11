# rust notes — el worker explicado concepto a concepto

esto es para entender `src/lib.rs` linea x linea, viniendo de typescript. no es un tutorial de rust generico: es exactamente lo q usa este worker, en el orden en q aparece.

## 1. por q compila a wasm y no a binario

cloudflare workers corre v8 (el motor de chrome), no linux. no podes correr un binario nativo ahi. lo q haces es compilar rust a **webassembly** y v8 lo ejecuta como si fuera un modulo js. el crate `worker` (workers-rs) genera el pegamento: vos escribis rust, `worker-build` produce un `shim.mjs` q v8 entiende. x eso en `Cargo.toml` esta `crate-type = ["cdylib"]` — "c dynamic library", el formato q wasm necesita, en vez de un binario con `fn main()`.

## 2. ownership — el concepto q no existe en js

en js/ts el garbage collector decide cuando muere un valor. en rust cada valor tiene UN dueño, y cuando el dueño sale de scope el valor muere ahi mismo, deterministicamente. esto nos mordio de verdad en este codigo:

```rust
// esto NO compila (E0716):
let fut = Box::pin(Fetch::Request(req).send());
```

`Fetch::Request(req)` crea un valor temporal sin dueño. `.send()` devuelve un future q lo referencia. al final de la linea el temporal muere... pero el future seguia vivo. en ts esto anda siempre xq el gc mantiene vivo todo lo referenciado; rust te obliga a decidir quien es el dueño. la solucion:

```rust
// el bloque async move SE QUEDA con el Fetch (ownership adentro):
let fut = Box::pin(async move { Fetch::Request(req).send().await });
```

`move` = "todo lo q uses de afuera, ahora es tuyo". analogo a capturar x valor en un closure, pero con garantia del compilador.

## 3. Result y ? — errores sin try/catch

rust no tiene excepciones. una funcion q puede fallar devuelve `Result<T, E>` (un enum: `Ok(valor)` o `Err(error)`). el operador `?` es el atajo:

```rust
let req = ua_request(url)?;   // si es Err, RETORNA el error a quien me llamo
```

es como si cada await en ts viniera con un `if (err) return err` automatico. la diferencia filosofica: el error es parte del TIPO, el compilador no te deja ignorarlo. donde no me importa el error uso `let _ = ...` (descarte explicito) o `match` con un fallback.

## 4. Option — el null q no explota

`Option<T>` es `Some(valor)` o `None`. es el `T | undefined` de ts pero el compilador te obliga a chequearlo SIEMPRE. en el codigo: `gh.1` es `Option<i64>` — si github no respondio, `None`, y el stat simplemente no se dibuja. imposible un "cannot read property of undefined" en runtime.

## 5. serde_json::Value — el JSON.parse de rust

lo normal en rust es deserializar json a structs tipados (serde). aca uso `Value` (json dinamico) a proposito: el `config.json` lo editas vos y no quiero q el worker explote si falta un campo. `cfg["theme"].as_str().unwrap_or("daydream")` = `cfg.theme ?? "daydream"` en ts. menos seguro q structs, mas flexible — tradeoff consciente para config editable.

## 6. async sin node — futures y join

rust async se parece a ts en la superficie (`async`/`await`) pero abajo es distinto: un future no HACE nada hasta q lo awaiteas (lazy), no hay event loop propio — aca lo presta v8. lo importante en el codigo:

- `join_all(...)` = `Promise.all(...)` — las 4 cadenas de sondas en paralelo
- `futures::join!(a, b)` = `Promise.all([a, b])` para dos cosas distintas (sondas + stats de github)
- `select(fut, timeout)` = `Promise.race` — asi implementamos el timeout de cada sonda: corre el fetch contra un `Delay` de 2.5s, gana el primero

y un detalle clave para jitterscope: cada HOST tiene su cadena SECUENCIAL de sondas (una tras otra, xq el jitter es entre-muestras-consecutivas), pero los 4 hosts corren en paralelo entre si.

## 7. la entropia de shannon (el corazon)

```rust
fn shannon(values: &[f64], k: usize) -> f64
```

`&[f64]` es un *slice*: una vista prestada sobre un array, sin copiar (en ts pasarias el array y listo; aca el `&` dice "lo miro, no me lo quedo"). la matematica: histograma de k=12 bins, `P(x) = cuenta/n`, `H = -Σ P·log2(P)`, normalizado x `log2(k)` para q de 0..1.

la decision de calibracion importante: los bins NO van del min al max de la ventana — van de `0.6×p50` a `1.8×p50` (anclados a la mediana). si binneas sobre el rango observado, una ventana angosta (23-31ms, red sana) reparte el ruido normal en todos los bins y H da alto = falso positivo. anclando al baseline, "predecible" significa "cerca de lo esperado": la red sana concentra la masa en 2-3 bins (H ≈ 0.2-0.35) y solo el caos real la dispersa. esto mismo aplica al mvp con udp.

## 8. format! y el svg

el svg se construye con `format!`, q es el template literal de rust con esteroides: `{x0}` captura la variable del scope (igual q `${x0}`), `{:.1}` = `toFixed(1)`. las llaves literales del svg/json se escapan doblandolas: `{{`. los strings crudos `r#"..."#` evitan escapar comillas (como un template literal sin interpolacion de comillas).

## 9. el entry point

```rust
#[event(fetch)]
async fn fetch(_req: Request, env: Env, _ctx: Context) -> Result<Response>
```

`#[event(fetch)]` es un macro q registra esta funcion como el handler http del worker (el `export default { fetch }` de js). `env` trae los secrets (`env.secret("GITHUB_TOKEN")`). el `match` de adentro: si todo ok, svg con `no-store`; si CUALQUIER cosa fallo, redirect 302 a la card commiteada x el ci. el fallback no es opcional — es lo q garantiza q tu perfil nunca se vea roto.

## 10. comandos

```bash
cargo build --target wasm32-unknown-unknown --release   # compilar a wasm
npx wrangler deploy                                      # build (worker-build) + deploy
npx wrangler tail                                        # logs en vivo del worker
```
