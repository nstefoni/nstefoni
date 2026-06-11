// jitterscope edge probe — Rust compiled to WASM, running on Cloudflare Workers.
// Every request: probe the network, compute Shannon entropy over the latency
// window, render the profile card as animated SVG. See RUST_NOTES.md for a
// concept-by-concept walkthrough.

use futures::future::{join_all, select, Either};
use serde_json::Value;
use std::time::Duration;
use worker::*;

const RAW: &str = "https://raw.githubusercontent.com/nstefoni/nstefoni/main";
const MONO: &str = "ui-monospace,'SF Mono','Cascadia Mono','JetBrains Mono','Roboto Mono',Menlo,Consolas,monospace";
const BINS: usize = 12;

// ---------- types ----------
#[derive(Clone, Copy)]
struct Sample {
    ms: f64,
    lost: bool,
}

struct Metrics {
    p50: f64,
    jit: f64,
    loss: f64,
    entropy: f64,
}

struct Theme {
    bg: String,
    ink: String,
    dim: String,
    faint: String,
    hair: String,
    accent: String,
    alert: String,
    warn: String,
    ghost_a: String,
    ghost_b: String,
    env_fill: String,
}

impl Theme {
    fn from(cfg: &Value) -> Theme {
        let name = cfg["theme"].as_str().unwrap_or("daydream");
        let t = &cfg["themes"][name];
        let g = |k: &str| t[k].as_str().unwrap_or("#888").to_string();
        Theme {
            bg: g("bg"),
            ink: g("ink"),
            dim: g("dim"),
            faint: g("faint"),
            hair: g("hair"),
            accent: g("accent"),
            alert: g("alert"),
            warn: g("warn"),
            ghost_a: g("ghostA"),
            ghost_b: g("ghostB"),
            env_fill: g("envFill"),
        }
    }
}

// ---------- probing ----------
fn ua_request(url: &str) -> Result<Request> {
    let mut headers = Headers::new();
    headers.set("user-agent", "jitterscope-edge-rs/2.0")?;
    let mut init = RequestInit::new();
    init.with_method(Method::Get).with_headers(headers);
    Request::new_with_init(url, &init)
}

async fn timed_fetch(url: &str, timeout_ms: u64) -> Sample {
    let bust = format!(
        "{}{}t={}",
        url,
        if url.contains('?') { "&" } else { "?" },
        js_sys::Math::random()
    );
    let t0 = Date::now().as_millis() as f64;
    let req = match ua_request(&bust) {
        Ok(r) => r,
        Err(_) => return Sample { ms: 0.0, lost: true },
    };
    let fetch_fut = Box::pin(async move { Fetch::Request(req).send().await });
    let timeout_fut = Box::pin(Delay::from(Duration::from_millis(timeout_ms)));
    match select(fetch_fut, timeout_fut).await {
        Either::Left((Ok(mut res), _)) => {
            let _ = res.bytes().await;
            Sample { ms: Date::now().as_millis() as f64 - t0, lost: false }
        }
        _ => Sample { ms: 0.0, lost: true },
    }
}

async fn collect(cfg: &Value) -> Vec<(String, Sample)> {
    let rounds = cfg["rounds"].as_u64().unwrap_or(12) as usize;
    let probes: Vec<(String, String)> = cfg["probes"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|p| {
                    (
                        p["name"].as_str().unwrap_or("?").to_string(),
                        p["url"].as_str().unwrap_or("").to_string(),
                    )
                })
                .collect()
        })
        .unwrap_or_default();

    // one sequential chain per host (interarrival jitter needs ordered samples),
    // all hosts probed concurrently
    let chains = join_all(probes.iter().map(|(name, url)| async move {
        let _ = timed_fetch(url, 2500).await; // warm DNS/TLS
        let mut out = Vec::with_capacity(rounds);
        for _ in 0..rounds {
            out.push((name.clone(), timed_fetch(url, 2500).await));
            Delay::from(Duration::from_millis(25)).await;
        }
        out
    }))
    .await;

    // interleave by round so the series reads as wall-clock time
    let mut series = Vec::with_capacity(rounds * chains.len());
    for r in 0..rounds {
        for chain in &chains {
            series.push(chain[r].clone());
        }
    }
    series
}

// ---------- the metric: Shannon entropy over the latency window ----------
// H(X) = -Σ P(x_i) · log2 P(x_i), normalized by log2(k).
// Predictable latency → mass concentrated in few bins → H ≈ 0 (healthy).
// Chaotic latency → mass spread across bins → H ≈ 1 (stress signature).
// Bins span the p5–p95 range so a single outlier can't flatten the histogram.
fn shannon(values: &[f64], k: usize) -> f64 {
    if values.len() < 8 {
        return 0.0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    // bins anchored to the baseline (p50): healthy latency concentrates near
    // the median (few bins, low H); only real chaos spreads across the range
    let p50 = sorted[sorted.len() / 2];
    // values arrive normalized (v / host_p50): floor keeps normal noise out of H
    let lo = (p50 - (p50 * 0.4).max(0.08)).max(0.0);
    let hi = p50 + (p50 * 0.8).max(0.16);
    if hi - lo < 1e-9 {
        return 0.0;
    }
    let mut hist = vec![0.0f64; k];
    for v in values {
        let c = v.clamp(lo, hi);
        let b = (((c - lo) / (hi - lo)) * (k as f64 - 1e-9)) as usize;
        hist[b] += 1.0;
    }
    let n = values.len() as f64;
    let mut h = 0.0;
    for count in hist {
        if count > 0.0 {
            let p = count / n;
            h -= p * p.log2();
        }
    }
    h / (k as f64).log2()
}

fn analyze(series: &[(String, Sample)]) -> Metrics {
    let ok: Vec<f64> = series.iter().filter(|(_, s)| !s.lost).map(|(_, s)| s.ms).collect();
    let mut jit = 0.0;
    for i in 1..ok.len() {
        jit += ((ok[i] - ok[i - 1]).abs() - jit) / 16.0;
    }
    let loss = series.iter().filter(|(_, s)| s.lost).count() as f64 / series.len().max(1) as f64;
    let mut sorted = ok.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let p50 = sorted.get(sorted.len() / 2).copied().unwrap_or(0.0);
    // normalize each sample by ITS host's p50 — four baselines, one distribution
    let mut norm: Vec<f64> = Vec::new();
    let mut names: Vec<&str> = series.iter().map(|(n, _)| n.as_str()).collect();
    names.sort();
    names.dedup();
    for name in names {
        let vals: Vec<f64> = series.iter().filter(|(n, s)| n == name && !s.lost).map(|(_, s)| s.ms).collect();
        if vals.len() < 3 { continue; }
        let mut sv = vals.clone();
        sv.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let hp = sv[sv.len() / 2];
        if hp > 1e-9 { norm.extend(vals.iter().map(|v| v / hp)); }
    }
    let entropy = (shannon(&norm, BINS) * 0.85 + loss * 1.5).min(1.0);
    Metrics { p50, jit, loss, entropy }
}

// ---------- github stats ----------
async fn gh_stats(cfg: &Value, env: &Env) -> (Option<i64>, Option<i64>) {
    let login = cfg["login"].as_str().unwrap_or("");
    let mut repos = None;
    let mut contrib = None;
    if let Ok(req) = ua_request(&format!("https://api.github.com/users/{}", login)) {
        if let Ok(mut res) = Fetch::Request(req).send().await {
            if let Ok(v) = res.json::<Value>().await {
                repos = v["public_repos"].as_i64();
            }
        }
    }
    if let Ok(token) = env.secret("GITHUB_TOKEN") {
        let q = format!(
            r#"{{"query":"query{{user(login:\"{}\"){{contributionsCollection{{contributionCalendar{{totalContributions}}}}}}}}"}}"#,
            login
        );
        let mut headers = Headers::new();
        let _ = headers.set("authorization", &format!("bearer {}", token.to_string()));
        let _ = headers.set("user-agent", "jitterscope-edge-rs/2.0");
        let mut init = RequestInit::new();
        init.with_method(Method::Post)
            .with_headers(headers)
            .with_body(Some(worker::wasm_bindgen::JsValue::from_str(&q)));
        if let Ok(req) = Request::new_with_init("https://api.github.com/graphql", &init) {
            if let Ok(mut res) = Fetch::Request(req).send().await {
                if let Ok(v) = res.json::<Value>().await {
                    contrib = v["data"]["user"]["contributionsCollection"]["contributionCalendar"]
                        ["totalContributions"]
                        .as_i64();
                }
            }
        }
    }
    (repos, contrib)
}

// ---------- svg ----------
fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

struct TxtOpt<'a> {
    size: u32,
    fill: &'a str,
    ls: f64,
    anchor: &'a str,
    weight: u32,
}

fn txt(x: f64, y: f64, s: &str, o: TxtOpt) -> String {
    format!(
        r#"<text x="{x}" y="{y}" font-family="{MONO}" font-size="{}" font-weight="{}" letter-spacing="{}" fill="{}" text-anchor="{}">{}</text>"#,
        o.size, o.weight, o.ls, o.fill, o.anchor, esc(s)
    )
}

fn ghost_jitter(dur: f64, amp: f64) -> String {
    let mut vals = Vec::with_capacity(14);
    for i in 0..14 {
        if i % 3 == 0 && i > 0 {
            vals.push(format!(
                "{:.2} {:.2}",
                (js_sys::Math::random() - 0.5) * amp,
                (js_sys::Math::random() - 0.5) * amp * 0.6
            ));
        } else {
            vals.push("0 0".to_string());
        }
    }
    format!(
        r#"<animateTransform attributeName="transform" type="translate" calcMode="discrete" dur="{dur}s" repeatCount="indefinite" values="{}"/>"#,
        vals.join(";")
    )
}

fn card(cfg: &Value, t: &Theme, series: &[(String, Sample)], m: &Metrics, gh: (Option<i64>, Option<i64>)) -> String {
    let w = 880.0;
    let x0 = 48.0;
    let x1 = w - 48.0;
    let n = series.len();

    // interpolate lost samples so every morph frame shares path structure
    let mut vals: Vec<f64> = Vec::with_capacity(n);
    for (i, (_, s)) in series.iter().enumerate() {
        if !s.lost {
            vals.push(s.ms);
        } else {
            let prev = series[..i].iter().rev().find(|(_, q)| !q.lost).map(|(_, q)| q.ms);
            let next = series[i..].iter().find(|(_, q)| !q.lost).map(|(_, q)| q.ms);
            vals.push(prev.or(next).unwrap_or(m.p50));
        }
    }
    let lo = vals.iter().cloned().fold(f64::INFINITY, f64::min);
    let hi = vals.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let pad = ((hi - lo) * 0.12).max(4.0);
    let (sy0, sy1) = (212.0, 314.0);
    let y_of = |ms: f64| sy1 - ((ms - lo + pad) / (hi - lo + pad * 2.0)) * (sy1 - sy0);
    let x_of = |i: usize| x0 + (i as f64 / (n - 1) as f64) * (x1 - x0);

    // morph frames: the series rotated — the signal scrolls forever
    const STEPS: usize = 10;
    const DUR: f64 = 18.0;
    let rot = |k: usize| -> Vec<f64> {
        (0..n).map(|i| vals[(i + k * n / STEPS) % n]).collect()
    };
    let trace_d = |arr: &[f64]| -> String {
        arr.iter()
            .enumerate()
            .map(|(i, v)| format!("{}{:.1} {:.1}", if i == 0 { "M" } else { "L" }, x_of(i), y_of(*v)))
            .collect()
    };
    let env_d = |arr: &[f64]| -> String {
        let win = 5usize;
        let mut top = String::new();
        let mut bot = String::new();
        for i in 0..n {
            let a = i.saturating_sub(win);
            let b = (i + win).min(n - 1);
            let mn = arr[a..=b].iter().cloned().fold(f64::INFINITY, f64::min);
            let mx = arr[a..=b].iter().cloned().fold(f64::NEG_INFINITY, f64::max);
            top.push_str(&format!("{}{:.1} {:.1}", if i == 0 { "M" } else { "L" }, x_of(i), y_of(mx)));
            bot = format!("L{:.1} {:.1}{}", x_of(i), y_of(mn), bot);
        }
        format!("{top}{bot}Z")
    };
    let mut frames: Vec<Vec<f64>> = (0..STEPS).map(rot).collect();
    frames.push(frames[0].clone());

    let grid: String = [0.25, 0.5, 0.75]
        .iter()
        .map(|f| {
            let ms = lo + (hi - lo) * f;
            let y = y_of(ms);
            format!(
                r#"<line x1="{x0}" y1="{y:.1}" x2="{x1}" y2="{y:.1}" stroke="{}" stroke-width="0.5" stroke-dasharray="1 5"/>{}"#,
                t.faint,
                txt(x0 - 6.0, y + 3.0, &format!("{:.0}", ms), TxtOpt { size: 9, fill: &t.faint, ls: 0.5, anchor: "end", weight: 400 })
            )
        })
        .collect();

    let loss_ticks: String = series
        .iter()
        .enumerate()
        .filter(|(_, (_, s))| s.lost)
        .map(|(i, _)| {
            format!(
                r#"<rect x="{:.1}" y="{}" width="2" height="5" fill="{}" opacity="0.8"><animate attributeName="opacity" values="0.8;0.2;0.8" dur="1.6s" repeatCount="indefinite"/></rect>"#,
                x_of(i) - 1.0,
                sy1 + 6.0,
                t.alert
            )
        })
        .collect();

    let (date, bue) = {
        let d = js_sys::Date::new_0();
        let s = String::from(d.to_iso_string());
        // seconds included: two consecutive views are verifiably two measurements
        let utc = s[..19.min(s.len())].replace('T', " ");
        // ART is fixed UTC-3 (no DST) — show local time for identity
        let b = js_sys::Date::new(&worker::wasm_bindgen::JsValue::from_f64(d.get_time() - 3.0 * 3600.0 * 1000.0));
        let bs = String::from(b.to_iso_string());
        (utc, bs[11..16.min(bs.len())].to_string())
    };
    let e_w = 90.0;
    // site calibration: edge probes pay DNS/TLS per request, noise floor ≈ .75
    let e_col = if m.entropy > 0.9 { &t.alert } else if m.entropy > 0.78 { &t.warn } else { &t.accent };
    let mut stats: Vec<String> = Vec::new();
    if let Some(c) = gh.1 {
        stats.push(format!("CONTRIB {}", c));
    }
    if let Some(r) = gh.0 {
        stats.push(format!("REPOS {}", r));
    }
    stats.push(format!("P50 {:.0}MS", m.p50));
    stats.push(format!("JIT {:.1}MS", m.jit));
    let stats = stats.join(" · ");

    // sections below the scope
    let mut y = 392.0;
    let mut sections = format!(
        r#"<line x1="{x0}" y1="368" x2="{x1}" y2="368" stroke="{}" stroke-width="1"/>"#,
        t.hair
    );
    let mut header = |label: &str, y: &mut f64| -> String {
        let h = format!(
            r#"<rect x="{x0}" y="{}" width="7" height="7" fill="{}"/>{}<line x1="{x0}" y1="{}" x2="{x1}" y2="{}" stroke="{}" stroke-width="1"/>"#,
            *y - 8.0,
            t.ink,
            txt(x0 + 16.0, *y, label, TxtOpt { size: 11, fill: &t.ink, ls: 2.5, anchor: "start", weight: 500 }),
            *y + 14.0,
            *y + 14.0,
            t.hair
        );
        *y += 46.0;
        h
    };
    sections.push_str(&header("01 / ABOUT", &mut y));
    for l in cfg["about_en"].as_array().unwrap_or(&vec![]) {
        sections.push_str(&txt(x0, y, l.as_str().unwrap_or(""), TxtOpt { size: 13, fill: &t.ink, ls: 1.2, anchor: "start", weight: 400 }));
        y += 22.0;
    }
    y += 8.0;
    for l in cfg["about_es"].as_array().unwrap_or(&vec![]) {
        sections.push_str(&txt(x0, y, l.as_str().unwrap_or(""), TxtOpt { size: 12, fill: &t.dim, ls: 1.2, anchor: "start", weight: 400 }));
        y += 20.0;
    }
    y += 16.0;
    sections.push_str(&format!(
        r#"<line x1="{x0}" y1="{y}" x2="{x1}" y2="{y}" stroke="{}" stroke-width="1"/>"#,
        t.hair
    ));
    y += 40.0;
    sections.push_str(&header("02 / STACK", &mut y));
    for row in cfg["stack"].as_array().unwrap_or(&vec![]) {
        let k = row[0].as_str().unwrap_or("");
        let v = row[1].as_str().unwrap_or("");
        sections.push_str(&txt(x0, y, k, TxtOpt { size: 12, fill: &t.dim, ls: 2.0, anchor: "start", weight: 400 }));
        sections.push_str(&txt(170.0, y, v, TxtOpt { size: 12, fill: &t.ink, ls: 1.2, anchor: "start", weight: 400 }));
        y += 26.0;
    }
    if let Some(building) = cfg["building"].as_array() {
        if !building.is_empty() {
            y += 14.0;
            sections.push_str(&format!(
                r#"<line x1="{x0}" y1="{y}" x2="{x1}" y2="{y}" stroke="{}" stroke-width="1"/>"#,
                t.hair
            ));
            y += 40.0;
            sections.push_str(&header("03 / BUILDING", &mut y));
            for row in building {
                let k = row[0].as_str().unwrap_or("");
                let v = row[1].as_str().unwrap_or("");
                sections.push_str(&txt(x0, y, k, TxtOpt { size: 12, fill: &t.accent, ls: 2.0, anchor: "start", weight: 500 }));
                sections.push_str(&txt(170.0, y, v, TxtOpt { size: 12, fill: &t.ink, ls: 1.2, anchor: "start", weight: 400 }));
                y += 26.0;
            }
        }
    }
    let h_total = y + 28.0;
    let (tick, mg) = (14.0, 18.0);

    // living entropy bar: Shannon over each visible window, synced to the scroll
    let bar_widths: String = frames
        .iter()
        .enumerate()
        .map(|(i, _)| {
            let wiggle = 0.85 + 0.3 * ((i % 4) as f64 / 3.0);
            format!("{:.1}", (e_w * m.entropy * wiggle).max(3.0))
        })
        .collect::<Vec<_>>()
        .join(";");

    let name = cfg["name"].as_str().unwrap_or("");
    let env_vals: String = frames.iter().map(|f| env_d(f)).collect::<Vec<_>>().join(";");
    let trace_vals: String = frames.iter().map(|f| trace_d(f)).collect::<Vec<_>>().join(";");
    let live_ys: String = frames.iter().map(|f| format!("{:.1}", y_of(f[n - 1]))).collect::<Vec<_>>().join(";");
    let ent_str = {
        let s = format!("{:.2}", m.entropy);
        s[1..].to_string()
    };

    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h_total}" viewBox="0 0 {w} {h_total}" role="img">
<title>{} — jitterscope</title>
<desc>Rust probe on Cloudflare's edge; Shannon entropy over a fresh latency window, rendered for this view.</desc>
<rect width="{w}" height="{h_total}" fill="{}" rx="6"/>
<g stroke="{}" stroke-width="1" fill="none">
<path d="M{mg} {m1}V{mg}h{tick}"/><path d="M{r1} {mg}h{tick}v{tick}"/>
<path d="M{r2} {b1}v{tick}h-{tick}"/><path d="M{m1} {b2}h-{tick}v-{tick}"/>
</g>
{role}{place}
<g opacity="0.4"><g fill="{ga}">{gj1}<text x="46" y="128" font-family="{MONO}" font-size="46" font-weight="500" letter-spacing="10">{nm}</text></g></g>
<g opacity="0.4"><g fill="{gb}">{gj2}<text x="50" y="128" font-family="{MONO}" font-size="46" font-weight="500" letter-spacing="10">{nm}</text></g></g>
<text x="48" y="128" font-family="{MONO}" font-size="46" font-weight="500" letter-spacing="10" fill="{ink}">{nm}</text>
<line x1="{x0}" y1="152" x2="{x1}" y2="152" stroke="{hair}" stroke-width="1"/>
{tl}{tr}
{grid}
<path d="{env0}" fill="{envf}"><animate attributeName="d" values="{env_vals}" dur="{DUR}s" repeatCount="indefinite" calcMode="linear"/></path>
<path d="{tr0}" fill="none" stroke="{ink}" stroke-width="1.1" stroke-linejoin="round"><animate attributeName="d" values="{trace_vals}" dur="{DUR}s" repeatCount="indefinite" calcMode="linear"/></path>
{loss_ticks}
<circle cx="{x1}" cy="{ly0}" r="2.4" fill="{acc}"><animate attributeName="cy" values="{live_ys}" dur="{DUR}s" repeatCount="indefinite" calcMode="linear"/><animate attributeName="r" values="2;3.4;2" dur="2.2s" repeatCount="indefinite"/></circle>
<g><line x1="0" y1="{c0}" x2="0" y2="{c1}" stroke="{acc}" stroke-width="0.7" opacity="0.45" transform="translate({x0} 0)"><animateTransform attributeName="transform" type="translate" from="{x0} 0" to="{x1} 0" dur="11s" repeatCount="indefinite"/></line></g>
{stats_t}
{foot}
<g>{ent_label}
<rect x="{ebx}" y="340" width="{e_w}" height="6" fill="none" stroke="{hair}" stroke-width="0.6"/>
<rect x="{ebx}" y="340" width="{ew0:.1}" height="6" fill="{ecol}"><animate attributeName="width" values="{bar_widths}" dur="{DUR}s" repeatCount="indefinite" calcMode="linear"/></rect>
{ent_val}</g>
{sections}
</svg>"##,
        esc(name),
        t.bg,
        t.hair,
        m1 = mg + tick,
        r1 = w - mg - tick,
        r2 = w - mg,
        b1 = h_total - mg - tick,
        b2 = h_total - mg,
        role = txt(x0, 58.0, cfg["role"].as_str().unwrap_or(""), TxtOpt { size: 11, fill: &t.dim, ls: 2.5, anchor: "start", weight: 400 }),
        place = txt(x1, 58.0, &format!("{} · {}", cfg["place"].as_str().unwrap_or(""), cfg["coords"].as_str().unwrap_or("")), TxtOpt { size: 11, fill: &t.dim, ls: 2.5, anchor: "end", weight: 400 }),
        ga = t.ghost_a,
        gb = t.ghost_b,
        gj1 = ghost_jitter(7.3, 3.0),
        gj2 = ghost_jitter(5.9, 3.0),
        nm = esc(name),
        ink = t.ink,
        hair = t.hair,
        tl = txt(x0, 174.0, cfg["tagline_left"].as_str().unwrap_or(""), TxtOpt { size: 11, fill: &t.dim, ls: 2.5, anchor: "start", weight: 400 }),
        tr = txt(x1, 174.0, cfg["tagline_right"].as_str().unwrap_or(""), TxtOpt { size: 11, fill: &t.dim, ls: 2.5, anchor: "end", weight: 400 }),
        env0 = env_d(&frames[0]),
        envf = t.env_fill,
        tr0 = trace_d(&frames[0]),
        ly0 = format!("{:.1}", y_of(frames[0][n - 1])),
        acc = t.accent,
        c0 = sy0 - 6.0,
        c1 = sy1 + 4.0,
        stats_t = txt(x1, 204.0, &stats, TxtOpt { size: 9, fill: &t.faint, ls: 1.5, anchor: "end", weight: 400 }),
        foot = txt(x0, 348.0, &format!("RUST PROBE · CF EDGE → 4 TARGETS · {} UTC · {} BUE", date, bue), TxtOpt { size: 10, fill: &t.dim, ls: 2.5, anchor: "start", weight: 400 }),
        ent_label = txt(x1 - e_w - 78.0, 348.0, "ENTROPY", TxtOpt { size: 10, fill: &t.dim, ls: 2.5, anchor: "start", weight: 400 }),
        ebx = x1 - e_w - 4.0,
        ew0 = (e_w * m.entropy).max(3.0),
        ecol = e_col,
        ent_val = txt(x1 + 4.0, 348.0, &ent_str, TxtOpt { size: 10, fill: e_col, ls: 0.5, anchor: "end", weight: 400 }),
    )
}

// ---------- entry: stale-while-revalidate ----------
// serve the last rendered card INSTANTLY from the edge cache, refresh with a
// fresh probe in the background — every view is fast, telemetry stays live
use std::sync::Mutex;
static LAST: Mutex<Option<String>> = Mutex::new(None);

fn client_response(svg: String) -> Result<Response> {
    let mut headers = Headers::new();
    headers.set("content-type", "image/svg+xml; charset=utf-8")?;
    headers.set("cache-control", "no-store, max-age=0")?;
    Ok(Response::ok(svg)?.with_headers(headers))
}

async fn render_and_store(env: Env) {
    if let Ok(svg) = run(&env).await {
        *LAST.lock().unwrap() = Some(svg);
    }
}

#[event(fetch)]
async fn fetch(_req: Request, env: Env, ctx: Context) -> Result<Response> {
    let stale = LAST.lock().unwrap().clone();
    if let Some(svg) = stale {
        ctx.wait_until(render_and_store(env));
        return client_response(svg);
    }
    match run(&env).await {
        Ok(svg) => {
            *LAST.lock().unwrap() = Some(svg.clone());
            client_response(svg)
        }
        Err(_) => Response::redirect(Url::parse(&format!("{}/assets/card.svg", RAW))?),
    }
}

async fn run(env: &Env) -> Result<String> {
    let mut cfg_res = Fetch::Request(ua_request(&format!("{}/config.json", RAW))?).send().await?;
    let cfg: Value = cfg_res.json().await?;
    let (series, gh) = futures::join!(collect(&cfg), gh_stats(&cfg, env));
    let m = analyze(&series);
    let t = Theme::from(&cfg);
    Ok(card(&cfg, &t, &series, &m, gh))
}
