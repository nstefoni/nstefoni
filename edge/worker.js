// jitterscope edge renderer — the FULL profile card, rendered per request.
// Every view of the README triggers fresh probes from Cloudflare's edge.
// Source of truth: config.json in the repo (fetched + cached 10 min).
// Fallback: on any error, redirect to the CI-committed card.
// Secret (optional): GITHUB_TOKEN → CONTRIB stat via GraphQL.

const RAW = "https://raw.githubusercontent.com/nstefoni/nstefoni/main";
const MONO =
  "ui-monospace,'SF Mono','Cascadia Mono','JetBrains Mono','Roboto Mono',Menlo,Consolas,monospace";

// ---------- tiny in-isolate cache ----------
const mem = new Map();
async function cached(key, ttlMs, fn) {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn();
  mem.set(key, { t: Date.now(), v });
  return v;
}

// ---------- probing ----------
async function sampleOnce(url) {
  const t0 = Date.now();
  try {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 2500);
    const res = await fetch(url, {
      signal: ac.signal,
      cf: { cacheTtl: 0 },
      headers: { "user-agent": "jitterscope-edge/2.0" },
    });
    await res.arrayBuffer().catch(() => {});
    clearTimeout(to);
    return { ms: Date.now() - t0, lost: false };
  } catch {
    return { ms: 0, lost: true };
  }
}

async function collect(cfg) {
  // per-host sequential chains (interarrival jitter), hosts in parallel
  const chains = await Promise.all(
    cfg.probes.map(async (p) => {
      await sampleOnce(p.url); // warm
      const out = [];
      for (let r = 0; r < cfg.rounds; r++) {
        out.push({ probe: p.name, ...(await sampleOnce(p.url)) });
        await new Promise((ok) => setTimeout(ok, 25));
      }
      return out;
    })
  );
  const series = [];
  for (let r = 0; r < cfg.rounds; r++)
    for (let h = 0; h < chains.length; h++) series.push(chains[h][r]);
  return series;
}

function analyze(series) {
  const ok = series.filter((s) => !s.lost).map((s) => s.ms);
  let J = 0;
  for (let i = 1; i < ok.length; i++) J += (Math.abs(ok[i] - ok[i - 1]) - J) / 16;
  const loss = series.filter((s) => s.lost).length / series.length;
  const p50 = [...ok].sort((a, b) => a - b)[Math.floor(ok.length / 2)] || 0;
  const entropy = Math.min(1, 0.12 + 0.55 * (J / (J + 45)) + loss * 1.4);
  return { J, loss, entropy, p50 };
}

// ---------- github stats (cached 10 min) ----------
function ghStats(cfg, env) {
  return cached("gh", 600000, async () => {
    const out = { repos: null, contrib: null };
    try {
      const u = await (
        await fetch(`https://api.github.com/users/${cfg.login}`, {
          headers: { "user-agent": "jitterscope-edge/2.0" },
        })
      ).json();
      out.repos = u.public_repos;
    } catch {}
    if (env.GITHUB_TOKEN) {
      try {
        const q = `query{user(login:"${cfg.login}"){contributionsCollection{contributionCalendar{totalContributions}}}}`;
        const r = await (
          await fetch("https://api.github.com/graphql", {
            method: "POST",
            headers: {
              authorization: `bearer ${env.GITHUB_TOKEN}`,
              "user-agent": "jitterscope-edge/2.0",
            },
            body: JSON.stringify({ query: q }),
          })
        ).json();
        out.contrib =
          r.data.user.contributionsCollection.contributionCalendar.totalContributions;
      } catch {}
    }
    return out;
  });
}

// ---------- svg ----------
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function card(cfg, series, m, gh) {
  const T = cfg.themes[cfg.theme];
  const txt = (x, y, str, { size = 11, fill = T.dim, ls = 2.5, anchor = "start", w = 400 } = {}) =>
    `<text x="${x}" y="${y}" font-family="${MONO}" font-size="${size}" font-weight="${w}" letter-spacing="${ls}" fill="${fill}" text-anchor="${anchor}">${esc(str)}</text>`;
  const ghostJitter = (dur, amp) => {
    const v = [];
    for (let i = 0; i < 14; i++)
      v.push(
        i % 3 === 0 && i > 0
          ? `${((Math.random() - 0.5) * amp).toFixed(2)} ${((Math.random() - 0.5) * amp * 0.6).toFixed(2)}`
          : "0 0"
      );
    return `<animateTransform attributeName="transform" type="translate" calcMode="discrete" dur="${dur}s" repeatCount="indefinite" values="${v.join(";")}"/>`;
  };

  const W = 880, X0 = 48, X1 = W - 48;
  const n = series.length;
  const vals = series.map((s) => (s.lost ? null : s.ms));
  for (let i = 0; i < n; i++) {
    if (vals[i] == null) {
      let a = i - 1; while (a >= 0 && vals[a] == null) a--;
      let b = i + 1; while (b < n && vals[b] == null) b++;
      vals[i] = vals[a >= 0 ? a : b] ?? m.p50;
    }
  }
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max(4, (hi - lo) * 0.12);
  const sy0 = 212, sy1 = 314;
  const yOf = (ms) => sy1 - ((ms - lo + pad) / (hi - lo + pad * 2)) * (sy1 - sy0);
  const xOf = (i) => X0 + (i / (n - 1)) * (X1 - X0);

  const STEPS = 10;
  const rot = (k) => vals.map((_, i) => vals[(i + Math.round((k * n) / STEPS)) % n]);
  const traceD = (arr) =>
    arr.map((v, i) => `${i ? "L" : "M"}${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`).join("");
  const envD = (arr) => {
    const w = 5;
    let top = "", bot = "";
    for (let i = 0; i < n; i++) {
      let mn = Infinity, mx = -Infinity;
      for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) {
        mn = Math.min(mn, arr[j]); mx = Math.max(mx, arr[j]);
      }
      top += `${i ? "L" : "M"}${xOf(i).toFixed(1)} ${yOf(mx).toFixed(1)}`;
      bot = `L${xOf(i).toFixed(1)} ${yOf(mn).toFixed(1)}` + bot;
    }
    return top + bot + "Z";
  };
  const frames = [];
  for (let k = 0; k < STEPS; k++) frames.push(rot(k));
  frames.push(frames[0]);
  const DUR = 18;

  const grid = [0.25, 0.5, 0.75]
    .map((f) => {
      const ms = lo + (hi - lo) * f, y = yOf(ms);
      return `<line x1="${X0}" y1="${y.toFixed(1)}" x2="${X1}" y2="${y.toFixed(1)}" stroke="${T.faint}" stroke-width="0.5" stroke-dasharray="1 5"/>` +
        txt(X0 - 6, y + 3, ms.toFixed(0), { size: 9, ls: 0.5, anchor: "end", fill: T.faint });
    })
    .join("");
  const lossTicks = series
    .map((s, i) => (s.lost ? `<rect x="${(xOf(i) - 1).toFixed(1)}" y="${sy1 + 6}" width="2" height="5" fill="${T.alert}" opacity="0.8"><animate attributeName="opacity" values="0.8;0.2;0.8" dur="1.6s" repeatCount="indefinite"/></rect>` : ""))
    .join("");

  const date = new Date().toISOString().slice(0, 16).replace("T", " ");
  const eW = 90;
  const eCol = m.entropy > 0.62 ? T.alert : m.entropy > 0.4 ? T.warn : T.accent;
  const stats = [
    gh.contrib != null ? `CONTRIB ${gh.contrib}` : null,
    gh.repos != null ? `REPOS ${gh.repos}` : null,
    `P50 ${m.p50.toFixed(0)}MS`,
    `JIT ${m.J.toFixed(1)}MS`,
  ].filter(Boolean).join(" · ");

  let y = 392;
  let sections = `<line x1="${X0}" y1="368" x2="${X1}" y2="368" stroke="${T.hair}" stroke-width="1"/>`;
  const header = (label) => {
    const h = `<rect x="${X0}" y="${y - 8}" width="7" height="7" fill="${T.ink}"/>` +
      txt(X0 + 16, y, label, { fill: T.ink, w: 500 }) +
      `<line x1="${X0}" y1="${y + 14}" x2="${X1}" y2="${y + 14}" stroke="${T.hair}" stroke-width="1"/>`;
    y += 46;
    return h;
  };
  sections += header("01 / ABOUT");
  for (const l of cfg.about_en) { sections += txt(X0, y, l, { size: 13, fill: T.ink, ls: 1.2 }); y += 22; }
  y += 8;
  for (const l of cfg.about_es) { sections += txt(X0, y, l, { size: 12, fill: T.dim, ls: 1.2 }); y += 20; }
  sections += `<rect x="${(X0 + cfg.about_es[cfg.about_es.length - 1].length * 8.45 + 12).toFixed(0)}" y="${y - 32}" width="7" height="12" fill="${T.accent}"><animate attributeName="opacity" values="1;1;0;0" dur="1.15s" repeatCount="indefinite"/></rect>`;
  y += 16;
  sections += `<line x1="${X0}" y1="${y}" x2="${X1}" y2="${y}" stroke="${T.hair}" stroke-width="1"/>`;
  y += 40;
  sections += header("02 / STACK");
  for (const [k, v] of cfg.stack) {
    sections += txt(X0, y, k, { size: 12, fill: T.dim, ls: 2 });
    sections += txt(170, y, v, { size: 12, fill: T.ink, ls: 1.2 });
    y += 26;
  }
  const H = y + 28, tick = 14, mg = 18;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">
<title>${esc(cfg.name)} — jitterscope</title>
<desc>Rendered on request at Cloudflare's edge; the trace is a fresh network measurement.</desc>
<rect width="${W}" height="${H}" fill="${T.bg}" rx="6"/>
<g stroke="${T.hair}" stroke-width="1" fill="none">
<path d="M${mg} ${mg + tick}V${mg}h${tick}"/><path d="M${W - mg - tick} ${mg}h${tick}v${tick}"/>
<path d="M${W - mg} ${H - mg - tick}v${tick}h${-tick}"/><path d="M${mg + tick} ${H - mg}h${-tick}v${-tick}"/>
</g>
${txt(X0, 58, cfg.role)}
${txt(X1, 58, `${cfg.place} · ${cfg.coords}`, { anchor: "end" })}
<g opacity="0.4"><g fill="${T.ghostA}">${ghostJitter(7.3, 3)}<text x="46" y="128" font-family="${MONO}" font-size="46" font-weight="500" letter-spacing="10">${esc(cfg.name)}</text></g></g>
<g opacity="0.4"><g fill="${T.ghostB}">${ghostJitter(5.9, 3)}<text x="50" y="128" font-family="${MONO}" font-size="46" font-weight="500" letter-spacing="10">${esc(cfg.name)}</text></g></g>
<text x="48" y="128" font-family="${MONO}" font-size="46" font-weight="500" letter-spacing="10" fill="${T.ink}">${esc(cfg.name)}</text>
<line x1="${X0}" y1="152" x2="${X1}" y2="152" stroke="${T.hair}" stroke-width="1"/>
${txt(X0, 174, cfg.tagline_left)}
${txt(X1, 174, cfg.tagline_right, { anchor: "end" })}
${grid}
<path d="${envD(frames[0])}" fill="${T.envFill}">
<animate attributeName="d" values="${frames.map(envD).join(";")}" dur="${DUR}s" repeatCount="indefinite" calcMode="linear"/>
</path>
<path d="${traceD(frames[0])}" fill="none" stroke="${T.ink}" stroke-width="1.1" stroke-linejoin="round">
<animate attributeName="d" values="${frames.map(traceD).join(";")}" dur="${DUR}s" repeatCount="indefinite" calcMode="linear"/>
</path>
${lossTicks}
<circle cx="${X1}" cy="${yOf(frames[0][n - 1]).toFixed(1)}" r="2.4" fill="${T.accent}">
<animate attributeName="cy" values="${frames.map((f) => yOf(f[n - 1]).toFixed(1)).join(";")}" dur="${DUR}s" repeatCount="indefinite" calcMode="linear"/>
<animate attributeName="r" values="2;3.4;2" dur="2.2s" repeatCount="indefinite"/>
</circle>
<g><line x1="0" y1="${sy0 - 6}" x2="0" y2="${sy1 + 4}" stroke="${T.accent}" stroke-width="0.7" opacity="0.45" transform="translate(${X0} 0)">
<animateTransform attributeName="transform" type="translate" from="${X0} 0" to="${X1} 0" dur="11s" repeatCount="indefinite"/>
</line></g>
${stats ? txt(X1, 204, stats, { size: 9, ls: 1.5, anchor: "end", fill: T.faint }) : ""}
${txt(X0, 348, `JITTERSCOPE · ${n} SAMPLES · EDGE ${date} UTC · RENDERED FOR THIS VIEW`, { size: 10 })}
<g>${txt(X1 - eW - 78, 348, "ENTROPY", { size: 10 })}
<rect x="${X1 - eW - 4}" y="340" width="${eW}" height="6" fill="none" stroke="${T.hair}" stroke-width="0.6"/>
<rect x="${X1 - eW - 4}" y="340" width="${Math.max(3, eW * m.entropy).toFixed(1)}" height="6" fill="${eCol}">
<animate attributeName="opacity" values="1;0.55;1" dur="3.1s" repeatCount="indefinite"/>
</rect>
${txt(X1 + 4, 348, m.entropy.toFixed(2).slice(1), { size: 10, fill: eCol, ls: 0.5, anchor: "end" })}</g>
${sections}
</svg>`;
}

// ---------- entry ----------
export default {
  async fetch(request, env) {
    try {
      const cfg = await cached("cfg", 600000, async () =>
        (await fetch(`${RAW}/config.json`, { cf: { cacheTtl: 300 } })).json()
      );
      const [series, gh] = await Promise.all([collect(cfg), ghStats(cfg, env)]);
      const m = analyze(series);
      return new Response(card(cfg, series, m, gh), {
        headers: {
          "content-type": "image/svg+xml; charset=utf-8",
          "cache-control": "no-store, max-age=0",
        },
      });
    } catch (e) {
      // edge hiccup → serve the CI-committed card instead
      return Response.redirect(`${RAW}/assets/card.svg`, 302);
    }
  },
};
