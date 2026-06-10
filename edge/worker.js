// jitterscope edge renderer — optional real-time upgrade for the README hero.
// Deploy free on Cloudflare Workers (wrangler deploy). Every request probes the
// network from the edge and renders a fresh SVG strip. Point the README at it:
//   <img src="https://jitterscope.<your-subdomain>.workers.dev/strip.svg" />
// Cache-Control: no-store keeps GitHub's Camo proxy from freezing it.

const THEME = {
  bg: "#232e36", ink: "#ede8dc", dim: "#93a0a8",
  hair: "rgba(237,232,220,0.25)", faint: "rgba(237,232,220,0.13)",
  acc: "#e8893c", alert: "#ff4530", warn: "#ffb340",
  envFill: "rgba(232,137,60,0.08)",
};
const PROBES = [
  "https://api.github.com/",
  "https://registry.npmjs.org/",
  "https://www.cloudflare.com/cdn-cgi/trace",
  "https://vercel.com/",
];
const MONO = "ui-monospace,'SF Mono',Menlo,Consolas,monospace";

async function sample(url) {
  const t0 = Date.now();
  try {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 2500);
    await fetch(url, { cf: { cacheTtl: 0 }, signal: ac.signal, headers: { "user-agent": "jitterscope-edge/1.0" } });
    clearTimeout(to);
    return { ms: Date.now() - t0, lost: false };
  } catch { return { ms: 0, lost: true }; }
}

export default {
  async fetch(request) {
    const series = [];
    for (let r = 0; r < 6; r++)
      for (const u of PROBES) series.push(await sample(u));

    const ok = series.filter((s) => !s.lost).map((s) => s.ms);
    let J = 0;
    for (let i = 1; i < ok.length; i++) J += (Math.abs(ok[i] - ok[i - 1]) - J) / 16;
    const loss = series.filter((s) => s.lost).length / series.length;
    const ent = Math.min(1, J / 30 + loss * 2);
    const p50 = [...ok].sort((a, b) => a - b)[Math.floor(ok.length / 2)] || 0;

    const W = 880, H = 120, x0 = 48, x1 = W - 48, y0 = 26, y1 = 86;
    const lo = Math.min(...ok), hi = Math.max(...ok), pad = Math.max(3, (hi - lo) * 0.12);
    const yOf = (ms) => y1 - ((ms - lo + pad) / (hi - lo + pad * 2)) * (y1 - y0);
    const xOf = (i) => x0 + (i / (series.length - 1)) * (x1 - x0);
    let d = "", pen = false, ticks = "";
    series.forEach((s, i) => {
      if (s.lost) { pen = false; ticks += `<rect x="${(xOf(i) - 1).toFixed(1)}" y="${y1 + 6}" width="2" height="4" fill="${THEME.alert}" opacity="0.8"/>`; return; }
      d += (pen ? "L" : "M") + xOf(i).toFixed(1) + " " + yOf(s.ms).toFixed(1);
      pen = true;
    });
    const eCol = ent > 0.6 ? THEME.alert : ent > 0.35 ? THEME.warn : THEME.acc;
    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${THEME.bg}" rx="6"/>
<path d="${d}" fill="none" stroke="${THEME.ink}" stroke-width="1.1" stroke-linejoin="round"/>
${ticks}
<circle cx="${x1}" cy="${yOf(ok[ok.length - 1] || p50).toFixed(1)}" r="2.4" fill="${THEME.acc}">
<animate attributeName="r" values="2;3.4;2" dur="2.2s" repeatCount="indefinite"/></circle>
<text x="${x0}" y="${H - 12}" font-family="${MONO}" font-size="10" letter-spacing="2.5" fill="${THEME.dim}">RENDERED ON REQUEST · ${now} UTC · P50 ${p50.toFixed(0)}MS · JIT ${J.toFixed(1)}MS</text>
<rect x="${x1 - 90}" y="${H - 20}" width="90" height="6" fill="none" stroke="${THEME.hair}" stroke-width="0.6"/>
<rect x="${x1 - 90}" y="${H - 20}" width="${Math.max(3, 90 * ent).toFixed(1)}" height="6" fill="${eCol}"/>
</svg>`;
    return new Response(svg, {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  },
};
