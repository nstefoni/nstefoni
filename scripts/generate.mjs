#!/usr/bin/env node
// jitterscope profile generator — probes the network, renders ONE living card.
// The trace scrolls continuously via SMIL path morphing between rotations of
// the real measured series, so the chart is generative and never still.
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(readFileSync(join(ROOT, "config.json"), "utf8"));

const T = cfg.themes[process.env.THEME || cfg.theme];
const MONO =
  "ui-monospace,'SF Mono','Cascadia Mono','JetBrains Mono','Roboto Mono',Menlo,Consolas,monospace";

// ---------- probing ----------
async function sampleOnce(url) {
  const t0 = performance.now();
  try {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 4000);
    const res = await fetch(url, {
      method: "GET",
      signal: ac.signal,
      cache: "no-store",
      headers: { "user-agent": "jitterscope-profile/1.0" },
    });
    await res.arrayBuffer().catch(() => {});
    clearTimeout(to);
    return { ms: performance.now() - t0, lost: false };
  } catch {
    return { ms: 0, lost: true };
  }
}

async function collect() {
  const series = [];
  for (const p of cfg.probes) await sampleOnce(p.url); // warm DNS/TLS
  for (let r = 0; r < cfg.rounds; r++) {
    for (const p of cfg.probes) {
      series.push({ probe: p.name, ...(await sampleOnce(p.url)) });
      await new Promise((ok) => setTimeout(ok, 80));
    }
  }
  const ok = series.filter((s) => !s.lost);
  return ok.length >= series.length * 0.5 ? series : null;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function synthetic() {
  const rnd = mulberry32(Date.now() % 2147483647);
  const out = [];
  for (let i = 0; i < cfg.rounds * cfg.probes.length; i++) {
    const base = 26 + Math.sin(i * 0.4) * 4;
    out.push({
      probe: cfg.probes[i % cfg.probes.length].name,
      ms: base + (rnd() - 0.5) * 8 + (rnd() < 0.06 ? rnd() * 60 : 0),
      lost: rnd() < 0.02,
    });
  }
  return out;
}

// RFC 3550-style smoothed jitter; entropy saturates instead of pinning red
function analyze(series) {
  const ok = series.filter((s) => !s.lost).map((s) => s.ms);
  let J = 0;
  for (let i = 1; i < ok.length; i++) J += (Math.abs(ok[i] - ok[i - 1]) - J) / 16;
  const loss = series.filter((s) => s.lost).length / series.length;
  const p50 = [...ok].sort((a, b) => a - b)[Math.floor(ok.length / 2)] || 0;
  const entropy = Math.min(1, 0.12 + 0.55 * (J / (J + 45)) + loss * 1.4);
  return { J, loss, entropy, p50 };
}

// ---------- optional GitHub stats ----------
async function ghStats() {
  const out = { repos: null, contrib: null };
  try {
    const u = await (
      await fetch(`https://api.github.com/users/${cfg.login}`, {
        headers: { "user-agent": "jitterscope-profile/1.0" },
      })
    ).json();
    out.repos = u.public_repos;
  } catch {}
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) {
    try {
      const q = `query{user(login:"${cfg.login}"){contributionsCollection{contributionCalendar{totalContributions}}}}`;
      const r = await (
        await fetch("https://api.github.com/graphql", {
          method: "POST",
          headers: { authorization: `bearer ${token}`, "user-agent": "jitterscope-profile/1.0" },
          body: JSON.stringify({ query: q }),
        })
      ).json();
      out.contrib = r.data.user.contributionsCollection.contributionCalendar.totalContributions;
    } catch {}
  }
  return out;
}

// ---------- svg helpers ----------
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function txt(x, y, str, { size = 11, fill = T.dim, ls = 2.5, anchor = "start", w = 400 } = {}) {
  return `<text x="${x}" y="${y}" font-family="${MONO}" font-size="${size}" font-weight="${w}" letter-spacing="${ls}" fill="${fill}" text-anchor="${anchor}">${esc(str)}</text>`;
}
function ghostJitter(dur, amp) {
  const v = [];
  for (let i = 0; i < 14; i++)
    v.push(
      i % 3 === 0 && i > 0
        ? `${((Math.random() - 0.5) * amp).toFixed(2)} ${((Math.random() - 0.5) * amp * 0.6).toFixed(2)}`
        : "0 0"
    );
  return `<animateTransform attributeName="transform" type="translate" calcMode="discrete" dur="${dur}s" repeatCount="indefinite" values="${v.join(";")}"/>`;
}

// ---------- the single card ----------
function card(series, m, gh) {
  const W = 880, X0 = 48, X1 = W - 48;
  const n = series.length;

  // lost samples → interpolated values so every morph frame shares structure
  const vals = series.map((s) => (s.lost ? null : s.ms));
  for (let i = 0; i < n; i++) {
    if (vals[i] == null) {
      let a = i - 1; while (a >= 0 && vals[a] == null) a--;
      let b = i + 1; while (b < n && vals[b] == null) b++;
      vals[i] = vals[a >= 0 ? a : b] ?? m.p50;
    }
  }
  const ok = vals;
  const lo = Math.min(...ok), hi = Math.max(...ok);
  const pad = Math.max(4, (hi - lo) * 0.12);

  const sy0 = 212, sy1 = 314;
  const yOf = (ms) => sy1 - ((ms - lo + pad) / (hi - lo + pad * 2)) * (sy1 - sy0);
  const xOf = (i) => X0 + (i / (n - 1)) * (X1 - X0);

  // morph variants: the series rotated — the signal scrolls forever
  const STEPS = 10;
  const rot = (k) => ok.map((_, i) => ok[(i + Math.round((k * n) / STEPS)) % n]);
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
  const traceVals = frames.map(traceD).join(";");
  const envVals = frames.map(envD).join(";");
  const liveYs = frames.map((f) => yOf(f[n - 1]).toFixed(1)).join(";");
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

  // sections below the scope
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
  y += 16;
  sections += `<line x1="${X0}" y1="${y}" x2="${X1}" y2="${y}" stroke="${T.hair}" stroke-width="1"/>`;
  y += 40;
  sections += header("02 / STACK");
  for (const [k, v] of cfg.stack) {
    sections += txt(X0, y, k, { size: 12, fill: T.dim, ls: 2 });
    sections += txt(170, y, v, { size: 12, fill: T.ink, ls: 1.2 });
    y += 26;
  }
  const H = y + 28;
  const tick = 14, mg = 18;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">
<title>${esc(cfg.name)} — jitterscope</title>
<desc>Live network jitter probed from CI; the trace scrolls through the real measured series.</desc>
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
<animate attributeName="d" values="${envVals}" dur="${DUR}s" repeatCount="indefinite" calcMode="linear"/>
</path>
<path d="${traceD(frames[0])}" fill="none" stroke="${T.ink}" stroke-width="1.1" stroke-linejoin="round">
<animate attributeName="d" values="${traceVals}" dur="${DUR}s" repeatCount="indefinite" calcMode="linear"/>
</path>
${lossTicks}
<circle cx="${X1}" cy="${yOf(frames[0][n - 1]).toFixed(1)}" r="2.4" fill="${T.accent}">
<animate attributeName="cy" values="${liveYs}" dur="${DUR}s" repeatCount="indefinite" calcMode="linear"/>
<animate attributeName="r" values="2;3.4;2" dur="2.2s" repeatCount="indefinite"/>
</circle>
<g><line x1="0" y1="${sy0 - 6}" x2="0" y2="${sy1 + 4}" stroke="${T.accent}" stroke-width="0.7" opacity="0.45" transform="translate(${X0} 0)">
<animateTransform attributeName="transform" type="translate" from="${X0} 0" to="${X1} 0" dur="11s" repeatCount="indefinite"/>
</line></g>
${stats ? txt(X1, 204, stats, { size: 9, ls: 1.5, anchor: "end", fill: T.faint }) : ""}
${txt(X0, 348, `JITTERSCOPE · GITHUB CI PROBE · ${date} UTC`, { size: 10 })}
<g>${txt(X1 - eW - 78, 348, "ENTROPY", { size: 10 })}
<rect x="${X1 - eW - 4}" y="340" width="${eW}" height="6" fill="none" stroke="${T.hair}" stroke-width="0.6"/>
<rect x="${X1 - eW - 4}" y="340" width="${Math.max(3, eW * m.entropy).toFixed(1)}" height="6" fill="${eCol}">
<animate attributeName="width" values="${frames.map((f) => { const w16 = f.slice(-16); let J = 0; for (let i = 1; i < w16.length; i++) J += (Math.abs(w16[i] - w16[i - 1]) - J) / 16; return Math.max(3, eW * Math.min(1, 0.12 + 0.55 * (J / (J + 45)) + m.loss * 1.4)).toFixed(1); }).join(";")}" dur="${DUR}s" repeatCount="indefinite" calcMode="linear"/>
</rect>
${txt(X1 + 4, 348, m.entropy.toFixed(2).slice(1), { size: 10, fill: eCol, ls: 0.5, anchor: "end" })}</g>
${sections}
</svg>`;
}

// ---------- main ----------
const series = (await collect()) || synthetic();
const metrics = analyze(series);
const gh = await ghStats();

const OUT = process.env.OUT_DIR || "assets";
mkdirSync(join(ROOT, OUT), { recursive: true });
writeFileSync(join(ROOT, OUT, "card.svg"), card(series, metrics, gh));
writeFileSync(
  join(ROOT, OUT, "telemetry.json"),
  JSON.stringify({ at: new Date().toISOString(), metrics, samples: series }, null, 2)
);
if (!process.env.THEME) {
  // only the active theme owns the live site's palette (previews must not clobber it)
  mkdirSync(join(ROOT, "web"), { recursive: true });
  writeFileSync(
    join(ROOT, "web", "theme.css"),
    `:root{--bg:${T.bg};--ink:${T.ink};--dim:${T.dim};--hair:${T.hair};--acc:${T.accent};--alert:${T.alert};--warn:${T.warn};}`
  );
}
console.log(
  `ok · ${series.length} samples · p50 ${metrics.p50.toFixed(1)}ms · jitter ${metrics.J.toFixed(2)}ms · entropy ${metrics.entropy.toFixed(3)}`
);
