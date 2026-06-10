#!/usr/bin/env node
// jitterscope profile generator — measures real network jitter from this machine
// (or the CI runner) and renders it into the profile SVGs. Zero dependencies.
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(readFileSync(join(ROOT, "config.json"), "utf8"));

// ---------- palette (themes live in config.json; THEME env overrides) ----------
const T = cfg.themes[process.env.THEME || cfg.theme];
const BG = T.bg;
const INK = T.ink;
const DIM = T.dim;
const FAINT = T.faint;
const HAIR = T.hair;
const CYAN = T.accent;
const RED = T.alert;
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
  // warm-up (DNS/TLS) so the series measures jitter, not cold-start
  for (const p of cfg.probes) await sampleOnce(p.url);
  for (let r = 0; r < cfg.rounds; r++) {
    for (const p of cfg.probes) {
      const s = await sampleOnce(p.url);
      series.push({ probe: p.name, ...s });
      await new Promise((ok) => setTimeout(ok, 80));
    }
  }
  const ok = series.filter((s) => !s.lost);
  if (ok.length < series.length * 0.5) return null; // offline-ish: fall back
  return series;
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
  const n = cfg.rounds * cfg.probes.length;
  for (let i = 0; i < n; i++) {
    const base = 26 + Math.sin(i * 0.4) * 4;
    const spike = rnd() < 0.06 ? rnd() * 60 : 0;
    out.push({
      probe: cfg.probes[i % cfg.probes.length].name,
      ms: base + (rnd() - 0.5) * 8 + spike,
      lost: rnd() < 0.02,
    });
  }
  return out;
}

// RFC 3550-style smoothed interarrival jitter + loss → entropy index 0..1
function analyze(series) {
  const ok = series.filter((s) => !s.lost).map((s) => s.ms);
  let J = 0;
  for (let i = 1; i < ok.length; i++) J += (Math.abs(ok[i] - ok[i - 1]) - J) / 16;
  const mean = ok.reduce((a, b) => a + b, 0) / Math.max(1, ok.length);
  const sigma = Math.sqrt(
    ok.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, ok.length)
  );
  const loss = series.filter((s) => s.lost).length / series.length;
  const entropy = Math.min(1, J / 30 + sigma / 90 + loss * 2);
  const p50 = [...ok].sort((a, b) => a - b)[Math.floor(ok.length / 2)] || 0;
  return { J, sigma, loss, entropy, mean, p50 };
}

// ---------- optional GitHub stats ----------
async function ghStats() {
  const out = { repos: null, followers: null, contrib: null };
  try {
    const u = await (
      await fetch(`https://api.github.com/users/${cfg.login}`, {
        headers: { "user-agent": "jitterscope-profile/1.0" },
      })
    ).json();
    out.repos = u.public_repos;
    out.followers = u.followers;
  } catch {}
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) {
    try {
      const q = `query{user(login:"${cfg.login}"){contributionsCollection{contributionCalendar{totalContributions}}}}`;
      const r = await (
        await fetch("https://api.github.com/graphql", {
          method: "POST",
          headers: {
            authorization: `bearer ${token}`,
            "user-agent": "jitterscope-profile/1.0",
          },
          body: JSON.stringify({ query: q }),
        })
      ).json();
      out.contrib =
        r.data.user.contributionsCollection.contributionCalendar
          .totalContributions;
    } catch {}
  }
  return out;
}

// ---------- svg helpers ----------
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function txt(x, y, str, { size = 11, fill = DIM, ls = 2.5, anchor = "start", w = 400 } = {}) {
  return `<text x="${x}" y="${y}" font-family="${MONO}" font-size="${size}" font-weight="${w}" letter-spacing="${ls}" fill="${fill}" text-anchor="${anchor}">${esc(str)}</text>`;
}

function ticks(W, H, m = 18, len = 14) {
  const c = HAIR;
  return `<g stroke="${c}" stroke-width="1">
<path d="M${m} ${m + len}V${m}h${len}" fill="none"/>
<path d="M${W - m - len} ${m}h${len}v${len}" fill="none"/>
<path d="M${W - m} ${H - m - len}v${len}h${-len}" fill="none"/>
<path d="M${m + len} ${H - m}h${-len}v${-len}" fill="none"/>
</g>`;
}

function ghostJitter(dur, amp) {
  const v = [];
  const steps = 14;
  for (let i = 0; i < steps; i++) {
    v.push(
      i % 3 === 0 && i > 0
        ? `${((Math.random() - 0.5) * amp).toFixed(2)} ${((Math.random() - 0.5) * amp * 0.6).toFixed(2)}`
        : "0 0"
    );
  }
  return `<animateTransform attributeName="transform" type="translate" calcMode="discrete" dur="${dur}s" repeatCount="indefinite" values="${v.join(";")}"/>`;
}

// ---------- hero ----------
function hero(series, m, gh) {
  const W = 880, H = 380;
  const sx0 = 48, sx1 = W - 48, sy0 = 212, sy1 = 318;
  const ok = series.filter((s) => !s.lost).map((s) => s.ms);
  const lo = Math.min(...ok), hi = Math.max(...ok);
  const pad = Math.max(4, (hi - lo) * 0.12);
  const yOf = (ms) =>
    sy1 - ((ms - lo + pad) / (hi - lo + pad * 2)) * (sy1 - sy0);
  const xOf = (i) => sx0 + (i / (series.length - 1)) * (sx1 - sx0);

  let d = "", pen = false;
  const lossTicks = [];
  series.forEach((s, i) => {
    if (s.lost) { pen = false; lossTicks.push(xOf(i)); return; }
    const c = `${xOf(i).toFixed(1)} ${yOf(s.ms).toFixed(1)}`;
    d += pen ? `L${c}` : `M${c}`;
    pen = true;
  });

  // envelope (rolling min/max, window 5)
  const wnd = 5;
  let top = "", bot = "";
  for (let i = 0; i < series.length; i++) {
    let mn = Infinity, mx = -Infinity;
    for (let j = Math.max(0, i - wnd); j <= Math.min(series.length - 1, i + wnd); j++) {
      if (series[j].lost) continue;
      mn = Math.min(mn, series[j].ms); mx = Math.max(mx, series[j].ms);
    }
    if (!isFinite(mn)) { mn = m.p50; mx = m.p50; }
    top += `${top ? "L" : "M"}${xOf(i).toFixed(1)} ${yOf(mx).toFixed(1)}`;
    bot = `L${xOf(i).toFixed(1)} ${yOf(mn).toFixed(1)}` + bot;
  }
  const lastIdx = series.length - 1;
  const lastOk = [...series].reverse().find((s) => !s.lost) || series[0];
  const liveX = xOf(series.indexOf(lastOk)), liveY = yOf(lastOk.ms);

  const grid = [0.25, 0.5, 0.75]
    .map((f) => {
      const ms = lo + (hi - lo) * f;
      const y = yOf(ms);
      return `<line x1="${sx0}" y1="${y}" x2="${sx1}" y2="${y}" stroke="${FAINT}" stroke-width="0.5" stroke-dasharray="1 5"/>` +
        txt(sx0 - 6, y + 3, `${ms.toFixed(0)}`, { size: 9, ls: 0.5, anchor: "end", fill: "rgba(233,231,224,0.34)" });
    })
    .join("");

  const date = new Date().toISOString().slice(0, 16).replace("T", " ");
  const eW = 90;
  const eFill = m.entropy > 0.6 ? RED : m.entropy > 0.35 ? T.warn : CYAN;
  const stats = [
    gh.contrib != null ? `CONTRIB ${gh.contrib}` : null,
    gh.repos != null ? `REPOS ${gh.repos}` : null,
    `P50 ${m.p50.toFixed(0)}MS`,
    `JIT ${m.J.toFixed(1)}MS`,
  ].filter(Boolean).join(" · ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">
<title>${esc(cfg.name)} — jitterscope</title>
<desc>Live network jitter measured from CI, rendered as the profile hero.</desc>
<rect width="${W}" height="${H}" fill="${BG}" rx="6"/>
${ticks(W, H)}
${txt(48, 58, cfg.role, { fill: DIM })}
${txt(W - 48, 58, `${cfg.place} · ${cfg.coords}`, { fill: DIM, anchor: "end" })}
<g opacity="0.4"><g fill="${T.ghostA}">${ghostJitter(7.3, 2.6)}<text x="46" y="128" font-family="${MONO}" font-size="46" font-weight="500" letter-spacing="10">${esc(cfg.name)}</text></g></g>
<g opacity="0.4"><g fill="${T.ghostB}">${ghostJitter(5.9, 2.6)}<text x="50" y="128" font-family="${MONO}" font-size="46" font-weight="500" letter-spacing="10">${esc(cfg.name)}</text></g></g>
<text x="48" y="128" font-family="${MONO}" font-size="46" font-weight="500" letter-spacing="10" fill="${INK}">${esc(cfg.name)}</text>
<line x1="48" y1="152" x2="${W - 48}" y2="152" stroke="${HAIR}" stroke-width="1"/>
${txt(48, 174, cfg.tagline_left, { fill: DIM })}
${txt(W - 48, 174, cfg.tagline_right, { fill: DIM, anchor: "end" })}
${grid}
<path d="${top}${bot}Z" fill="${T.envFill}"/>
<path d="${d}" fill="none" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"/>
${lossTicks.map((x) => `<rect x="${(x - 1).toFixed(1)}" y="${sy1 + 6}" width="2" height="5" fill="${RED}" opacity="0.8"/>`).join("")}
<circle cx="${liveX.toFixed(1)}" cy="${liveY.toFixed(1)}" r="2.4" fill="${CYAN}">
<animate attributeName="r" values="2;3.4;2" dur="2.2s" repeatCount="indefinite"/>
<animate attributeName="opacity" values="1;0.45;1" dur="2.2s" repeatCount="indefinite"/>
</circle>
<g><line x1="0" y1="${sy0 - 6}" x2="0" y2="${sy1 + 4}" stroke="${CYAN}" stroke-width="0.7" opacity="0.45" transform="translate(${sx0} 0)">
<animateTransform attributeName="transform" type="translate" from="${sx0} 0" to="${sx1} 0" dur="11s" repeatCount="indefinite"/>
</line></g>
${txt(48, 348, `JITTERSCOPE · ${series.length} SAMPLES · GITHUB CI · LAST PROBE ${date} UTC`, { size: 10, fill: DIM })}
<g>${txt(W - 48 - eW - 78, 348, "ENTROPY", { size: 10, fill: DIM })}
<rect x="${W - 48 - eW - 4}" y="${340}" width="${eW}" height="6" fill="none" stroke="${HAIR}" stroke-width="0.6"/>
<rect x="${W - 48 - eW - 4}" y="${340}" width="${Math.max(3, eW * m.entropy).toFixed(1)}" height="6" fill="${eFill}">
<animate attributeName="opacity" values="1;0.55;1" dur="3.1s" repeatCount="indefinite"/>
</rect>
${txt(W - 48 + 4, 348, m.entropy.toFixed(2).slice(1), { size: 10, fill: eFill, ls: 0.5, anchor: "end" })}</g>
${stats ? txt(W - 48, 320, stats, { size: 9, ls: 1.5, anchor: "end", fill: "rgba(233,231,224,0.34)" }) : ""}
</svg>`;
}

// ---------- about / stack cards ----------
function card(title, bodyRows, H) {
  const W = 880;
  let body = "";
  bodyRows.forEach((r) => { body += r; });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">
<title>${esc(title)}</title>
<rect width="${W}" height="${H}" fill="${BG}" rx="6"/>
${ticks(W, H, 14, 12)}
<rect x="48" y="40" width="7" height="7" fill="${INK}"/>
${txt(64, 48, title, { fill: INK, w: 500 })}
<line x1="48" y1="62" x2="${W - 48}" y2="62" stroke="${HAIR}" stroke-width="1"/>
${body}
</svg>`;
}

function about() {
  const rows = [];
  let y = 94;
  for (const l of cfg.about_en) { rows.push(txt(48, y, l, { size: 13, fill: INK, ls: 1.2 })); y += 22; }
  y += 10;
  for (const l of cfg.about_es) { rows.push(txt(48, y, l, { size: 12, fill: DIM, ls: 1.2 })); y += 20; }
  rows.push(`<rect x="${48 + cfg.about_es[cfg.about_es.length - 1].length * 7.6 + 10}" y="${y - 30}" width="7" height="12" fill="${CYAN}"><animate attributeName="opacity" values="1;1;0;0" dur="1.15s" repeatCount="indefinite"/></rect>`);
  return card("01 / ABOUT", rows, y + 18);
}

function stack() {
  const rows = [];
  let y = 96;
  for (const [k, v] of cfg.stack) {
    rows.push(txt(48, y, k, { size: 12, fill: DIM, ls: 2 }));
    rows.push(txt(170, y, v, { size: 12, fill: INK, ls: 1.2 }));
    y += 26;
  }
  return card("02 / STACK", rows, y + 14);
}

// ---------- main ----------
const series = (await collect()) || synthetic();
const metrics = analyze(series);
const gh = await ghStats();

const OUT = process.env.OUT_DIR || "assets";
mkdirSync(join(ROOT, OUT), { recursive: true });
writeFileSync(join(ROOT, OUT, "hero.svg"), hero(series, metrics, gh));
writeFileSync(join(ROOT, OUT, "about.svg"), about());
writeFileSync(join(ROOT, OUT, "stack.svg"), stack());
// keep the live site in sync with the active theme
mkdirSync(join(ROOT, "web"), { recursive: true });
writeFileSync(
  join(ROOT, "web", "theme.css"),
  `:root{--bg:${BG};--ink:${INK};--dim:${DIM};--hair:${HAIR};--acc:${CYAN};--alert:${RED};--warn:${T.warn};}`
);
writeFileSync(
  join(ROOT, "assets", "telemetry.json"),
  JSON.stringify({ at: new Date().toISOString(), metrics, samples: series }, null, 2)
);
console.log(
  `ok · ${series.length} samples · p50 ${metrics.p50.toFixed(1)}ms · jitter ${metrics.J.toFixed(2)}ms · entropy ${metrics.entropy.toFixed(3)}`
);
