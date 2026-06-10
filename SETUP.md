# jitterscope profile — setup

Repo de perfil para `github.com/nstefoni`. Todo el contenido editable vive en `config.json` (textos, stack, sondas, temas). El tema activo es `daydream`; para cambiarlo: `"theme": "espresso"` y listo.

## Deploy (5 minutos)

1. **Repo.** Pushear este contenido al repo especial `nstefoni/nstefoni` (branch `main`). Si ya existe, reemplazar el contenido.

   ```bash
   git init && git add -A && git commit -m "jitterscope profile"
   git remote add origin git@github.com:nstefoni/nstefoni.git
   git push -f origin main
   ```

2. **Action de telemetría.** Corre sola (cron cada 6 h + manual desde la pestaña Actions). En Settings → Actions → General → Workflow permissions: activar **Read and write permissions**. Para más frecuencia, editar el cron en `.github/workflows/update-banner.yml` (mínimo razonable: `*/15 * * * *`).

3. **GitHub Pages (sitio vivo).** Settings → Pages → Source: **GitHub Actions**. El workflow `deploy-pages.yml` publica `/web` en `https://nstefoni.github.io/nstefoni/`. El sitio mide la conexión del visitante en tiempo real.

4. **Opcional — hero en tiempo real en el README.** El worker de `/edge` renderiza un strip SVG con mediciones frescas en cada request:

   ```bash
   cd edge && npx wrangler deploy
   ```

   Después, en `README.md` agregar debajo del hero:

   ```html
   <img src="https://jitterscope.<tu-subdominio>.workers.dev/strip.svg" width="880"/>
   ```

   `Cache-Control: no-store` evita que el proxy de imágenes de GitHub lo congele — cada vista del perfil dispara una medición nueva desde el edge.

## Regenerar local

```bash
node scripts/generate.mjs            # tema activo
THEME=espresso node scripts/generate.mjs   # probar otro tema
```

## Estructura

```
config.json                  textos, stack, sondas, temas
scripts/generate.mjs         sondas HTTP → jitter/entropía → SVGs animados
assets/                      hero.svg · about.svg · stack.svg · telemetry.json
web/                         jitterscope en Three.js (Pages)
edge/                        worker opcional de tiempo real
.github/workflows/           cron de telemetría + deploy de Pages
```
