/* US AI Stock Agent — public web app (framework-free).
   Renders client-side from frozen JSON produced by the local pipeline.
   Display-only · not buy/sell orders. No API key, no compute, no market calls. */
"use strict";

const DATA = "./data";
const cache = {};
async function getJSON(name) {
  if (cache[name]) return cache[name];
  const res = await fetch(`${DATA}/${name}`);
  if (!res.ok) throw new Error(`${res.status} ${name}`);
  cache[name] = await res.json();
  return cache[name];
}

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));

/* ---------- Supabase (auth + per-user portfolio/watchlist) ---------- */
let sb = null;
let currentUser = null;
function supa() {
  if (sb) return sb;
  if (window.supabase && window.SUPABASE_URL && window.SUPABASE_KEY) {
    sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY);
  }
  return sb;
}
// Full-universe per-ticker enrichment (cockpit-grade) from the public feed.
let _enrich = null;
async function enrichMap() {
  if (_enrich) return _enrich;
  try { _enrich = (await getJSON("ticker-enrich.json")).tickers || {}; }
  catch (_) { _enrich = {}; }
  return _enrich;
}

const PHASE = {
  STRONG_UPTREND: "var(--green)", UPTREND: "var(--green)", ACCUMULATION: "var(--teal)",
  NEUTRAL: "var(--mut)", DISTRIBUTION: "var(--amber)", STRONG_DOWNTREND: "var(--red)", DOWNTREND: "var(--red)",
};
const phaseBadge = (code) => {
  if (!code) return `<span class="subtle">—</span>`;
  const c = PHASE[code] || "var(--mut)";
  return `<span class="pill" style="color:${c};border-color:${c};background:transparent">${esc(code)}</span>`;
};
const c1Cell = (c1) => {
  // Prefer the per-ticker raw model probability; the calibrated c15_prob collapses
  // to ~9 quantile bins, so it's coarse. Keeps the Cockpit C1 == enrich.c1_prob
  // shown by the Portfolio table and the ticker-detail panel.
  const p = c1 && (c1.c15_prob_raw ?? c1.c15_prob);
  if (p == null) return `<span class="subtle">—</span>`;
  const pct = Math.round(p * 100);
  const c = pct >= 40 ? "var(--red)" : pct >= 30 ? "var(--amber)" : "var(--txt)";
  return `<span style="color:${c}">${pct}%</span>`;
};
const leadCell = (r) => {
  if (r.rank == null) return `<span class="subtle">—</span>`;
  const sc = r.score != null ? `·${r.score}` : "";
  const tr = r.score_trend ? ` ${esc(r.score_trend)}` : "";
  return `<span>#${r.rank}${sc}${tr}</span>`;
};
const mfColor = (mf) => /STRONG_INFLOW|INFLOW/.test(mf || "") ? "var(--green)"
  : /STRONG_OUTFLOW|OUTFLOW/.test(mf || "") ? "var(--red)" : "var(--mut)";

const VAL_LABEL = {
  CHEAP_WITH_STRENGTH: "var(--green)", CHEAP_BUT_WEAK: "var(--teal)", IN_LINE_WITH_LAYER: "var(--slate)",
  EXPENSIVE_LEADER: "var(--amber)", EXPENSIVE_AND_WEAKENING: "var(--red)", NO_PE_DATA: "var(--mut)",
};
const VAL_LEGEND = [
  ["CHEAP_WITH_STRENGTH", "Cheaper than layer & strong trend"],
  ["CHEAP_BUT_WEAK", "Cheap but weak momentum"],
  ["IN_LINE_WITH_LAYER", "Valued in line with layer"],
  ["EXPENSIVE_LEADER", "Expensive but leading"],
  ["EXPENSIVE_AND_WEAKENING", "Expensive & weakening"],
  ["NO_PE_DATA", "Missing / loss-making — no P/E"],
];

// caution component chips — fixed order + display labels matching the design
const CAUTION_KEYS = [
  ["c1z", "c1z"], ["qqq_close_location", "qqq_cloc"], ["supz", "supz"],
  ["flow_z", "flow_z"], ["flow_mom", "flow_mom"], ["c1_warn_pct", "c1_warn%"],
];
function chipColor(key, v) {
  if (key === "c1_warn_pct") return v >= 80 ? "var(--red)" : v >= 60 ? "var(--amber)" : "var(--mut)";
  const a = Math.abs(v);
  return a >= 1 ? "var(--red)" : a >= 0.4 ? "var(--amber)" : "var(--mut)";
}
function chipVal(key, v) {
  return key === "c1_warn_pct" ? (+v).toFixed(2) : `${v >= 0 ? "+" : ""}${(+v).toFixed(2)}`;
}

// Risk-zone caution sparkline: NORMAL/ELEVATED/HIGH bands shade the chart so the
// line's vertical position reads as a risk zone. Stretched SVG fills the width;
// the end-dot + threshold labels are HTML overlays (round, never distorted).
function sparkline(vals, elevated = 60, fire = 80) {
  if (!vals || vals.length < 2) return "";
  const W = 300, H = 56, PAD = 5, n = vals.length;
  const lo = Math.min(...vals, elevated), hi = Math.max(...vals, fire);
  const padv = ((hi - lo) || 1) * 0.10, dlo = lo - padv, drng = (hi + padv) - dlo;
  const Y = (v) => H - PAD - ((v - dlo) / drng) * (H - 2 * PAD);
  const clampY = (v) => Math.max(0, Math.min(H, Y(v)));
  const X = (i) => 3 + (i / (n - 1)) * (W - 6);
  const xy = vals.map((v, i) => [X(i), Y(v)]);
  const line = xy.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(" ");
  const last = xy[n - 1];
  const area = `M${xy[0][0].toFixed(1)},${H - 1}`
    + xy.map((q) => `L${q[0].toFixed(1)},${q[1].toFixed(1)}`).join("")
    + `L${last[0].toFixed(1)},${H - 1}Z`;
  const yF = clampY(fire), yE = clampY(elevated);
  const bands =
    `<rect x="0" y="0" width="${W}" height="${yF.toFixed(1)}" fill="var(--red)" fill-opacity=".08"></rect>`
    + `<rect x="0" y="${yF.toFixed(1)}" width="${W}" height="${Math.max(0, yE - yF).toFixed(1)}" fill="var(--amber)" fill-opacity=".06"></rect>`
    + `<rect x="0" y="${yE.toFixed(1)}" width="${W}" height="${Math.max(0, H - yE).toFixed(1)}" fill="var(--green)" fill-opacity=".05"></rect>`;
  const svg = `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="display:block" aria-hidden="true">
    <defs><linearGradient id="cauSpark" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff9e1b" stop-opacity=".24"/><stop offset="1" stop-color="#ff9e1b" stop-opacity="0"/></linearGradient></defs>
    ${bands}
    <line x1="0" x2="${W}" y1="${yF.toFixed(1)}" y2="${yF.toFixed(1)}" stroke="var(--red)" stroke-opacity=".45" stroke-width=".6" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"></line>
    <line x1="0" x2="${W}" y1="${yE.toFixed(1)}" y2="${yE.toFixed(1)}" stroke="var(--amber)" stroke-opacity=".42" stroke-width=".6" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"></line>
    <path d="${area}" fill="url(#cauSpark)" stroke="none"></path>
    <polyline points="${line}" fill="none" stroke="var(--amber)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"></polyline></svg>`;
  const lx = (last[0] / W) * 100, ly = (last[1] / H) * 100;
  const dot = `<span class="spark-dot" style="left:${lx.toFixed(1)}%;top:${ly.toFixed(1)}%"></span>`;
  const lbl = (y, t, cls) => `<span class="spark-lbl ${cls}" style="top:${((y / H) * 100).toFixed(1)}%">${t}</span>`;
  return svg + dot + lbl(yF, "80", "hi") + lbl(yE, "60", "el");
}

// Go board with depth — gradient stones, drop shadow, specular highlight, a gold
// "decisive move" with glow + last-move marker, and a coral "sacrifice" triangle.
// w=you · b=market · gold=decisive move · sac=sacrifice stone.
function goBoardSVG() {
  const N = 9, M = 38, STEP = 26, R = 12;
  const pos = (i) => M + i * STEP;
  const STONES = [
    { c: 4, r: 4, t: "w" }, { c: 4, r: 5, t: "w" }, { c: 5, r: 5, t: "w" },
    { c: 5, r: 6, t: "w" }, { c: 6, r: 6, t: "w" }, { c: 6, r: 7, t: "w" }, { c: 7, r: 6, t: "w" },
    { c: 2, r: 6, t: "w" }, { c: 2, r: 3, t: "gold" }, { c: 6, r: 1, t: "sac" },
    { c: 3, r: 2, t: "b" }, { c: 4, r: 2, t: "b" }, { c: 5, r: 2, t: "b" },
    { c: 7, r: 3, t: "b" }, { c: 7, r: 4, t: "b" }, { c: 2, r: 4, t: "b" }, { c: 3, r: 5, t: "b" }, { c: 6, r: 4, t: "b" },
  ];
  const STARS = [[2, 2], [6, 2], [4, 4], [2, 6], [6, 6]];
  const FILL = { w: "url(#gW)", b: "url(#gB)", gold: "url(#gG)", sac: "url(#gW)" };
  let g = "";
  for (let i = 0; i < N; i++) {
    g += `<line x1="${pos(0)}" y1="${pos(i)}" x2="${pos(8)}" y2="${pos(i)}" stroke="#363F49" stroke-width=".9"/>`;
    g += `<line x1="${pos(i)}" y1="${pos(0)}" x2="${pos(i)}" y2="${pos(8)}" stroke="#363F49" stroke-width=".9"/>`;
  }
  STARS.forEach(([c, r]) => { g += `<circle cx="${pos(c)}" cy="${pos(r)}" r="2.2" fill="#525D67"/>`; });
  let st = "";
  STONES.forEach((s) => {
    const x = pos(s.c), y = pos(s.r);
    if (s.t === "gold") {
      st += `<circle cx="${x}" cy="${y}" r="${R + 6}" fill="var(--amber)" fill-opacity=".14"/>`;
      st += `<circle cx="${x}" cy="${y}" r="${R + 3}" fill="none" stroke="var(--amber)" stroke-opacity=".35" stroke-width="1"/>`;
    }
    const stroke = s.t === "b" ? "#525D67" : (s.t === "gold" ? "#ffcf8c" : "#AAB0B6");
    st += `<circle cx="${x}" cy="${y}" r="${R}" fill="${FILL[s.t]}" stroke="${stroke}" stroke-width=".6" filter="url(#goSh)"/>`;
    st += `<ellipse cx="${x - 3.4}" cy="${y - 4}" rx="3.6" ry="2.4" fill="#fff" fill-opacity="${s.t === "b" ? 0.18 : 0.5}"/>`;
    if (s.t === "gold") st += `<circle cx="${x}" cy="${y}" r="2.6" fill="#3B2E12"/>`;
    if (s.t === "sac") st += `<path d="M${x} ${y - 5} L${x + 4.6} ${y + 3.6} L${x - 4.6} ${y + 3.6} Z" fill="none" stroke="#ff7a59" stroke-width="1.7" stroke-linejoin="round"/>`;
  });
  return `<svg width="158" height="158" viewBox="0 0 280 280" aria-label="Go board">
    <defs>
      <radialGradient id="gW" cx="36%" cy="30%" r="78%"><stop offset="0%" stop-color="#FFFFFF"/><stop offset="50%" stop-color="#E6E9EC"/><stop offset="100%" stop-color="#BBC0C6"/></radialGradient>
      <radialGradient id="gB" cx="36%" cy="30%" r="82%"><stop offset="0%" stop-color="#404A55"/><stop offset="48%" stop-color="#1C242C"/><stop offset="100%" stop-color="#080C10"/></radialGradient>
      <radialGradient id="gG" cx="36%" cy="30%" r="82%"><stop offset="0%" stop-color="#F6DEA3"/><stop offset="50%" stop-color="#D2AB55"/><stop offset="100%" stop-color="#9A7327"/></radialGradient>
      <radialGradient id="goBd" cx="42%" cy="36%" r="78%"><stop offset="0%" stop-color="#141A22"/><stop offset="100%" stop-color="#0E131A"/></radialGradient>
      <filter id="goSh" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="1.6" stdDeviation="1.6" flood-color="#000" flood-opacity="0.55"/></filter>
    </defs>
    <rect x="8" y="8" width="264" height="264" rx="14" fill="url(#goBd)" stroke="#2A333C" stroke-width="1"/>
    <rect x="8.5" y="8.5" width="263" height="263" rx="13.5" fill="none" stroke="rgba(255,158,27,.10)" stroke-width="1"/>
    <rect x="${pos(5.45)}" y="${pos(5.45)}" width="${pos(8) - pos(5.45) + 8}" height="${pos(8) - pos(5.45) + 8}" rx="7" fill="var(--amber)" fill-opacity="0.06"/>
    ${g}${st}</svg>`;
}

window.__toggleGate = function () {
  const b = document.getElementById("gate-banner");
  const btn = document.getElementById("gate-toggle");
  if (!b || !btn) return;
  const off = b.style.display !== "none";
  b.style.display = off ? "none" : "";
  btn.textContent = `GATE: ${off ? "ON" : "OFF"}`;
};

// Valuation legend → click-to-filter the table by valuation_label (click active = clear).
window.__valFilter = function (label) {
  const wrap = document.getElementById("val-table");
  if (!wrap) return;
  const cur = wrap.getAttribute("data-filter") || "";
  const next = cur === label ? "" : label;
  wrap.setAttribute("data-filter", next);
  const trs = wrap.querySelectorAll("tbody tr");
  let vis = 0;
  trs.forEach((tr) => {
    const show = !next || tr.getAttribute("data-vlabel") === next;
    tr.style.display = show ? "" : "none";
    if (show) vis++;
  });
  document.querySelectorAll(".vfilter").forEach((b) => {
    b.classList.toggle("active", (b.getAttribute("data-label") || "") === next);
  });
  const legend = document.querySelector(".legend");
  if (legend) legend.classList.toggle("filtering", !!next);
  const cnt = document.getElementById("val-count");
  if (cnt) cnt.innerHTML = `Showing <b>${vis}</b> / ${trs.length}`;
  const clr = document.getElementById("val-clear");
  if (clr) clr.hidden = !next;
};

/* ---------- setup_text → evidence chips + metric pairs ----------
   Mirrors @ai-stock/shared-presentation parseSetup so web matches the mobile
   chip redesign. DISPLAY relabel only — re-presents feed values, never recomputes
   (AGENTS.md data-integrity). Unknown keys/flags degrade gracefully. */
const SETUP_TOKEN_COLOR = { green: "var(--green)", red: "var(--red)", amber: "var(--amber)", teal: "var(--teal)", mut: "var(--mut)", txt: "var(--txt)" };
const ZONE_SOURCE_LABEL = { pivot_high: "Pivot high", range_high: "Range high", "52w_high": "52-week high" };
const SETUP_FLAG = {
  confirmed_above_zone: ["Confirmed above zone", "green"],
  failed_back_into_zone: ["Failed back into zone", "red"],
  extended_exhaustion_near_supply: ["Exhaustion near supply", "amber"],
  weak_retest_near_supply: ["Weak retest near supply", "amber"],
  no_active_zone: ["No active zone", "mut"],
  no_native_supply_state: ["No supply state", "mut"],
  event_gap_excluded: ["Event gap (excluded)", "mut"],
  context_etf_excluded: ["Context ETF (excluded)", "mut"],
  insufficient_history: ["Insufficient history", "mut"],
};
function humanizeToken(s) {
  const t = String(s).replace(/_/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : String(s);
}
function setupMetric(key, val) {
  switch (key) {
    case "vol20": return { label: "Volume", value: `${val}×`, hint: "vs 20d avg" };
    case "tr20": return { label: "Range", value: `${val}×`, hint: "vs 20d avg" };
    case "cloc": return { label: "Close", value: val, hint: "of day range" };
    case "zone": return { label: "Zone", value: ZONE_SOURCE_LABEL[val] || humanizeToken(val), hint: "" };
    default: return { label: humanizeToken(key), value: val, hint: "" };
  }
}
function setupHtml(text) {
  const raw = (text == null ? "" : String(text)).trim();
  if (!raw || raw === "—") return "—";
  const metrics = [], flags = [];
  for (const part of raw.split("|")) {
    const tok = part.trim();
    if (!tok) continue;
    const eq = tok.indexOf("=");
    if (eq > 0) metrics.push(setupMetric(tok.slice(0, eq), tok.slice(eq + 1)));
    else flags.push(SETUP_FLAG[tok] || [humanizeToken(tok), "mut"]);
  }
  const flagHtml = flags.length ? `<div class="setup-flags">${flags.map(([lbl, tk]) => {
    const c = SETUP_TOKEN_COLOR[tk] || "var(--mut)";
    return `<span class="ev" style="color:${c};border-color:${c}"><i style="background:${c}"></i>${esc(lbl)}</span>`;
  }).join("")}</div>` : "";
  const metricHtml = metrics.length ? `<div class="setup-metrics">${metrics.map((m) =>
    `<span class="mx"><span class="subtle">${esc(m.label)}</span> <strong>${esc(m.value)}</strong>${m.hint ? ` <span class="hint">${esc(m.hint)}</span>` : ""}</span>`).join("")}</div>` : "";
  return `<div class="setup">${flagHtml}${metricHtml}</div>`;
}

/* ---------- screens ---------- */
async function renderCockpit() {
  const d = await getJSON("cockpit-public.json");
  const mc = d.market_caution || {};
  const comp = mc.components || {};
  const gate = d.market_gate_on;

  const chips = CAUTION_KEYS.filter(([k]) => comp[k] != null).map(([k, lbl]) =>
    `<span class="chip">${esc(lbl)} <strong style="color:${chipColor(k, comp[k])}">${chipVal(k, comp[k])}</strong></span>`).join("");

  const triggerRows = (d.entry || []).map((r, i) => `<tr>
    <td class="r subtle">${i + 1}</td>
    <td class="tk">${esc(r.ticker)}</td>
    <td>${setupHtml(r.setup_text)}</td>
    <td class="subtle">${esc(r.stop_ref || "—")}</td>
    <td>${c1Cell(r.c1)}</td>
    <td class="subtle">${leadCell(r)}</td>
    <td>${phaseBadge(r.phase)}</td></tr>`).join("") ||
    `<tr><td colspan="7" class="subtle" style="padding:14px">No ENTRY trigger today.</td></tr>`;

  const ondeckRows = (d.continuation || []).map((r, i) => `<tr>
    <td class="r subtle">${i + 1}</td>
    <td class="tk">${esc(r.ticker)}</td>
    <td>${setupHtml(r.setup_text)}</td>
    <td>${c1Cell(r.c1)}</td>
    <td style="color:var(--amber)">${esc(r.why_waiting || "—")}</td>
    <td class="subtle">${leadCell(r)}</td>
    <td>${phaseBadge(r.phase)}</td></tr>`).join("") ||
    `<tr><td colspan="7" class="subtle" style="padding:14px">No on-deck names.</td></tr>`;

  const mom = d.momentum;
  const momChips = mom ? mom.leaders.map((m) => {
    const flags = (m.risk_flags && m.risk_flags.length) ? m.risk_flags : [];
    const isEntry = !!m.is_entry, hasRisk = flags.length > 0;
    // Baseline leaders stay neutral (all are elite ~RS95-100); only ENTRY (green) or
    // risk-flagged (amber) names stand out, so the eye lands on what needs attention.
    const dotColor = isEntry ? "var(--green)" : hasRisk ? "var(--amber)" : "var(--mut)";
    const cls = isEntry ? " is-entry" : hasRisk ? " has-risk" : "";
    const rs = Math.max(0, Math.min(100, Math.round(+m.rs_pctl || 0)));
    const title = hasRisk ? "Risk: " + flags.map((f) => f.label).join(", ")
      : isEntry ? "Entry trigger today"
      : (m.snapshot_clean ? "Clean snapshot" : "Unconfirmed snapshot");
    return `<a class="mw${cls}" data-tk="${esc(m.ticker)}" title="${esc(title)}">`
      + `<span class="mw-dot" style="background:${dotColor}"></span>`
      + `<strong class="mw-tk">${esc(m.ticker)}</strong>`
      + `<span class="mw-rs"><i>RS</i>${rs}</span>`
      + (m.top_decile ? `<span class="mw-star" title="Top 10% (1-year RS)">★</span>` : "")
      + (isEntry ? `<span class="mw-entry">ENTRY</span>` : "")
      + `</a>`;
  }).join("") : `<span class="subtle">Momentum data unavailable.</span>`;

  const gateColor = gate ? "var(--green)" : "var(--amber)";
  const tierU = (mc.tier || "").toUpperCase();
  const tierC = tierU === "HIGH" ? "var(--red)" : tierU === "NORMAL" ? "var(--green)" : "var(--amber)";
  const tierBg = tierU === "HIGH" ? "rgba(255,77,77,.12)" : tierU === "NORMAL" ? "rgba(38,208,124,.12)" : "rgba(255,158,27,.12)";

  return `
  <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
    <h1 class="h1big">Decision Desk</h1>
    <div style="text-align:right">
      <span class="pill" style="color:var(--teal);border-color:var(--teal);background:rgba(45,212,191,.12)">COVERAGE ${esc(d.meta.coverage_status || "—")}</span>
      <div class="subtle" style="margin-top:5px">ENTRY=${d.counts.entry} · ON-DECK=${d.counts.continuation}</div>
    </div>
  </div>

  <div class="philo">
    <div style="flex:0 0 auto">${goBoardSVG()}</div>
    <div style="flex:1 1 280px;min-width:240px">
      <h2>GO BOARD PHILOSOPHY</h2>
      <p class="philo-sub">Thinking from the Go board, applied to trading discipline.</p>
      <ul>
        <li><span style="color:var(--amber)">▸ Move slowly.</span> Every move is deliberate — keep <em>sente</em> (the initiative); don't chase price.</li>
        <li><span style="color:var(--green)">▸ Risk first.</span> Count your <em>liberties</em> (liquidity &amp; stops) before you count territory (profit).</li>
        <li><span style="color:var(--teal)">▸ Play the whole board.</span> Read the entire market — don't cling to one corner.</li>
        <li><span style="color:#ff7a59">▸ Sacrifice small.</span> Give up one stone (<em>sacrifice</em>) to save the whole group — that's your stop-loss.</li>
      </ul>
    </div>
  </div>

  <div class="cau">
    <div class="cau-left">
      <div class="cau-label">Market Caution</div>
      <div class="cau-num">
        <span class="cau-score" style="color:${tierC}">${mc.score ?? "—"}</span>
        <span class="subtle" style="font-size:15px">/100</span>
        <span class="pill" style="color:${tierC};border-color:${tierC};background:${tierBg};text-transform:uppercase">${esc(mc.tier || "—")}</span>
      </div>
      <div class="cau-scale">ELEVATED ≥ ${mc.elevated_threshold ?? 60} · HIGH ≥ ${mc.fire_threshold ?? 80}${d.caution_sessions ? ` · ${d.caution_sessions} sessions` : ""}</div>
    </div>
    <div class="cau-right">
      <div class="cau-spark">${sparkline(d.caution_history, mc.elevated_threshold ?? 60, mc.fire_threshold ?? 80)}</div>
      <div class="chips">${chips}</div>
    </div>
  </div>

  <div class="section-h" style="gap:12px">
    <h2>① New Triggers</h2>
    <button id="gate-toggle" class="gate-btn pill" style="color:${gateColor};border-color:${gateColor}" onclick="window.__toggleGate()">GATE: ${gate ? "ON" : "OFF"}</button>
  </div>
  <div id="gate-banner" class="banner-amber" style="${gate ? "display:none" : ""}">⚠ MARKET GATE: OFF (risk-off) — rows below are context (gate-off / early), not buy orders.</div>
  <div class="table-wrap"><table class="dc"><thead><tr>
    <th class="r">#</th><th>Ticker</th><th>Setup</th><th>Levels (Entry→Stop·Risk%)</th><th>C1</th><th>Lead</th><th>Phase</th>
  </tr></thead><tbody>${triggerRows}</tbody></table></div>

  <div class="section-h"><h2>🔥 Momentum Watch (1 Year)</h2></div>
  <div class="mom">${momChips}</div>

  <div class="section-h"><h2>② On-Deck — entering soon</h2><span class="cnt">· ${d.counts.continuation}</span></div>
  <div class="table-wrap"><table class="dc"><thead><tr>
    <th class="r">#</th><th>Ticker</th><th>Setup</th><th>C1</th><th>Blocker</th><th>Lead</th><th>Phase</th>
  </tr></thead><tbody>${ondeckRows}</tbody></table></div>`;
}

// Valuation freshness is authoritative in the bundle manifest (data/latest.json →
// screens.valuation), built from the valuation snapshot pointer. The dated payload
// (valuation-latest.json) does NOT carry coverage_status, so we read it here.
// Never default to FRESH: a missing/unknown status renders neutral UNKNOWN so a stale
// P/E can never be mislabeled green (AGENTS.md data-integrity guardrail).
const VAL_FRESH = {
  FRESH: { label: "FRESH", color: "var(--green)" },
  STALE: { label: "STALE", color: "var(--amber)" },
  UNKNOWN: { label: "FRESHNESS UNKNOWN", color: "var(--mut)" },
};
async function valuationFreshness() {
  try {
    const v = ((await getJSON("latest.json")).screens || {}).valuation || {};
    return { status: v.coverage_status || "UNKNOWN", age: v.freshness_age_days ?? null };
  } catch (_) {
    return { status: "UNKNOWN", age: null };
  }
}

async function renderValuation() {
  const d = await getJSON("valuation-latest.json");
  const fr = await valuationFreshness();
  const meta = VAL_FRESH[fr.status] || VAL_FRESH.UNKNOWN;
  const ageTxt = fr.age != null ? ` · ${fr.age}d old` : "";
  const staleNote =
    fr.status === "STALE"
      ? `<div class="banner-amber" style="margin-top:8px">⚠ Valuation fundamentals are ${
          fr.age != null ? `${fr.age}d ` : ""
        }old (as_of ${esc(d.as_of_date)}); fundamentals refresh is not part of the daily EOD flow — refresh before relying on P/E.</div>`
      : fr.status === "UNKNOWN"
        ? `<div class="banner-amber" style="margin-top:8px">⚠ Valuation freshness is unknown — treat P/E as possibly stale.</div>`
        : "";
  const rows = [...(d.tickers || [])].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const tableRows = rows.map((r) => {
    const vs = r.pe_vs_layer_pct;
    const vsTxt = vs == null ? `<span class="subtle">—</span>`
      : `<span style="color:${vs < 0 ? "var(--green)" : "var(--amber)"}">${(vs * 100).toFixed(0)}%</span>`;
    const pe = r.pe_display != null ? `${r.pe_display.toFixed(2)} <span class="subtle">${(r.pe_type || "")[0] || ""}</span>` : `<span class="subtle">—</span>`;
    const lc = VAL_LABEL[r.valuation_label] || "var(--mut)";
    return `<tr data-vlabel="${esc(r.valuation_label || "")}">
      <td class="tk">${esc(r.ticker)}</td>
      <td class="subtle" style="font-size:11px">${esc(r.ai_layer_code || "—")}</td>
      <td>${phaseBadge(r.phase_code)}</td>
      <td style="color:${mfColor(r.money_flow_state)};font-size:11px">${esc(r.money_flow_state || "—")}</td>
      <td class="r">${r.score != null ? r.score.toFixed(1) : "—"}</td>
      <td class="r">${pe}</td>
      <td class="r subtle">${r.layer_pe_median != null ? r.layer_pe_median.toFixed(1) : "—"}</td>
      <td class="r">${vsTxt}</td>
      <td><span class="pill" style="color:${lc};border-color:${lc};background:transparent;font-size:10px">${esc(r.valuation_label)}</span></td>
    </tr>`;
  }).join("");

  const counts = {};
  rows.forEach((r) => { const k = r.valuation_label || ""; counts[k] = (counts[k] || 0) + 1; });
  const legend = VAL_LEGEND.map(([k, t]) => {
    const c = VAL_LABEL[k], n = counts[k] || 0;
    return `<button class="vfilter" data-label="${k}" onclick="window.__valFilter('${k}')"${n ? "" : " disabled"}>`
      + `<span class="pill vf-pill" style="color:${c};border-color:${c}">${k}</span>`
      + `<span class="vf-desc">${esc(t)}</span><span class="vf-cnt">${n}</span></button>`;
  }).join("");

  return `
  <div><h1 class="h1big">P/E VALUATION LENS</h1>
    <div class="subtle" style="margin-top:4px">as_of ${esc(d.as_of_date)} · <strong style="color:${meta.color}">${meta.label}</strong>${ageTxt}</div>
    ${staleNote}</div>
  <div class="panel">
    <div class="legend-head">
      <div class="subtle" style="text-transform:uppercase;font-size:10.5px;letter-spacing:.05em">Legend <span style="text-transform:none;letter-spacing:0;color:var(--mut)">· click a label to filter</span></div>
      <div class="legend-right"><span class="legend-count" id="val-count">Showing <b>${rows.length}</b> / ${rows.length}</span><button class="vf-clear" id="val-clear" onclick="window.__valFilter('')" hidden>✕ Clear</button></div>
    </div>
    <div class="legend">${legend}</div>
  </div>
  <div class="table-wrap" id="val-table" data-filter=""><table class="dc"><thead><tr>
    <th>Ticker</th><th>Layer</th><th>Phase</th><th>MF</th><th class="r">Score</th><th class="r">P/E</th>
    <th class="r">Layer P/E</th><th class="r">vs Layer</th><th>Valuation Label</th>
  </tr></thead><tbody>${tableRows}</tbody></table></div>
  <div class="disclaimer">P/E so với median layer (median ưu tiên hơn trung bình) · ${d.valid_pe_count}/${d.ticker_count} mã có P/E · display-only, KHÔNG phải khuyến nghị.</div>`;
}

function renderLogin(msg) {
  if (currentUser) {
    return `<div class="locked"><div class="lk-card">
      <h2>Signed in</h2>
      <p class="subtle">${esc(currentUser.email || "")}</p>
      <button class="acct-btn" style="margin-top:14px" onclick="window.__logout()">Log out</button>
    </div></div>`;
  }
  return `<div class="locked"><div class="lk-card" style="text-align:left">
    <h2 style="text-align:center">US AI STOCK AGENT</h2>
    <div class="auth-tabs" style="display:flex;gap:2px;margin:8px 0 14px;justify-content:center">
      <button class="auth-tab active" data-mode="signin" onclick="window.__authMode('signin')">Sign in</button>
      <button class="auth-tab" data-mode="signup" onclick="window.__authMode('signup')">Sign up</button>
    </div>
    <form id="auth-form" onsubmit="return window.__authSubmit(event)">
      <input id="auth-email" type="email" placeholder="Email" autocomplete="email" required class="auth-input" />
      <input id="auth-pass" type="password" placeholder="Password" autocomplete="current-password" required minlength="6" class="auth-input" />
      <button type="submit" class="acct-btn" style="width:100%;margin-top:6px" id="auth-submit">Sign in</button>
    </form>
    <div id="auth-msg" class="subtle" style="margin-top:10px;min-height:16px;${msg ? "color:var(--red)" : ""}">${esc(msg || "")}</div>
    <p class="subtle" style="margin-top:10px;font-size:11px">Đăng nhập để quản lý Portfolio &amp; Watchlist riêng tư. Cockpit / Valuation xem được không cần đăng nhập.</p>
  </div></div>`;
}

function badgeHtml(label, color) {
  if (!label || label === "—") return `<span class="subtle">—</span>`;
  return `<span class="pill" style="color:${color};border-color:${color};background:transparent">${esc(label)}</span>`;
}
function c1Pct(prob) {
  if (prob == null) return `<span class="subtle">—</span>`;
  const pct = Math.round(prob * 100);
  const c = pct >= 40 ? "var(--red)" : pct >= 30 ? "var(--amber)" : "var(--txt)";
  return `<span style="color:${c}">${pct}%</span>`;
}
function leadHtml(lead) {
  if (!lead || lead.rank == null) return `<span class="subtle">—</span>`;
  const sc = lead.score != null ? `·${lead.score}` : "";
  const tr = lead.trend ? ` ${esc(lead.trend)}` : "";
  return `<span>#${lead.rank}${sc}${tr}</span>`;
}
function emlHtml(prob, conflict) {
  if (prob == null) return `<span class="subtle">—</span>`;
  const c = prob >= 0.5 ? "var(--green)" : "var(--txt)";
  const warn = conflict ? ` <span style="color:var(--red)" title="EML cao nhưng verdict EXIT/RISK">⚠</span>` : "";
  return `<span style="color:${c}">${Math.round(prob * 100)}%</span>${warn}`;
}

async function renderManager(kind) {
  if (!currentUser) return renderLogin("Đăng nhập để xem " + kind + ".");
  const client = supa();
  const [items, em] = await Promise.all([
    client.from("tracked_items").select("*").eq("kind", kind).order("sort_order").order("created_at"),
    enrichMap(),
  ]);
  if (items.error) return `<div class="status-line" style="color:var(--red)">Lỗi: ${esc(items.error.message)}</div>`;
  const isPort = kind === "PORTFOLIO";
  const del = (id) => `<td class="r"><button class="row-del" title="Delete" onclick="window.__delItem('${id}')">✕</button></td>`;

  const rows = (items.data || []).map((it) => {
    const e = em[it.ticker] || {};
    const sc = e.score != null ? (+e.score).toFixed(1) : "—";
    const mf = `<td style="color:${e.flow_color || "var(--mut)"};font-size:11px">${esc(e.flow || "—")}</td>`;
    if (isPort) {
      return `<tr>
        <td class="tk">${esc(it.ticker)}</td>
        <td>${badgeHtml(e.action, e.action_color)}</td>
        <td>${badgeHtml(e.health, e.health_color)}</td>
        <td>${c1Pct(e.c1_prob)}</td>
        ${mf}
        <td>${phaseBadge(e.phase)}</td>
        <td class="r">${sc}</td>
        <td class="subtle">${esc(e.stop_ref || "—")}</td>
        ${del(it.id)}</tr>`;
    }
    return `<tr>
      <td class="tk">${esc(it.ticker)}</td>
      <td>${badgeHtml(e.status, e.status_color)}</td>
      ${mf}
      <td>${phaseBadge(e.phase)}</td>
      <td class="subtle">${leadHtml(e.lead)}</td>
      <td class="r">${emlHtml(e.eml_prob, e.eml_conflict)}</td>
      ${del(it.id)}</tr>`;
  }).join("");

  const ncol = isPort ? 9 : 7;
  const body = rows || `<tr><td colspan="${ncol}" class="subtle" style="padding:14px">Chưa có mã — thêm mã đầu tiên.</td></tr>`;
  const head = isPort
    ? `<th>Ticker</th><th>Action</th><th>Health</th><th>C1</th><th>MF</th><th>Phase</th><th class="r">Score</th><th>Stop</th><th class="r"></th>`
    : `<th>Ticker</th><th>Status</th><th>MF</th><th>Phase</th><th>Lead</th><th class="r">EML</th><th class="r"></th>`;

  return `
  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
    <h1 class="h1big">${isPort ? "PORTFOLIO" : "WATCHLIST"} MANAGER</h1>
  </div>
  <form class="add-form" onsubmit="return window.__addItem(event,'${kind}')" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
    <input class="auth-input grow" id="add-ticker" placeholder="Ticker" required style="text-transform:uppercase;max-width:140px" />
    <button class="acct-btn" type="submit">Add</button>
  </form>
  <div id="mgr-msg" class="subtle" style="min-height:14px"></div>
  <div class="table-wrap"><table class="dc"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/* ---------- ticker detail (deep-link #t/<TICKER>) ---------- */
let _detail = null;
async function detailMap() {
  if (_detail) return _detail;
  try { _detail = (await getJSON("ticker-detail.json")).tickers || {}; }
  catch (_) { _detail = {}; }
  return _detail;
}

// Real exit ladder (sourced from rule.exit_signal_code) -> label + accent.
const EXIT_LADDER = {
  EXIT_0_HOLD: ["HOLD", "var(--green)", "No exit signal. Structure intact."],
  EXIT_1_TIGHTEN: ["TIGHTEN", "var(--teal)", "Tighten trailing stop; no new buys."],
  EXIT_2_TRIM: ["TRIM", "var(--amber)", "Reduce risk / trim exposure."],
  EXIT_3_EXIT: ["EXIT", "var(--red)", "Exit on close confirmation."],
  EXIT_3_HARD_EXIT: ["HARD EXIT", "var(--red)", "Hard exit. Structure broken."],
};
const fnum = (v, dp = 2) => v == null ? "—"
  : (+v).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
const fprob = (v) => v == null ? "—" : `${(v * 100).toFixed(1)}%`;
const fpctv = (v, dp = 1) => v == null ? "—" : `${v >= 0 ? "+" : ""}${(+v).toFixed(dp)}%`;

let _simCfg = null; // handed to wireDetail() after innerHTML assignment

async function renderTickerDetail(tk) {
  const [em, dm] = await Promise.all([enrichMap(), detailMap()]);
  const e = em[tk] || {};
  const d = dm[tk] || {};
  if (!em[tk] && !dm[tk]) {
    return `<div class="td-top"><button class="pill" onclick="window.__backDetail()">‹ Back</button></div>
      <div class="status-line" style="color:var(--red)">No data for ${esc(tk)}.</div>`;
  }

  const close = d.close, ma20 = d.ma20, ma50 = d.ma50, ma200 = d.ma200;
  const [vLabel, vColor, vMean] = EXIT_LADDER[d.exit_signal_code] || [d.exit_signal_code || "—", "var(--mut)", ""];
  const c1 = e.c1_prob, eml = e.eml_prob;
  const mf = e.flow || "—", mfColorV = e.flow_color || "var(--mut)";
  const phase = e.phase;

  const row = (k, v, cls, src) =>
    `<div class="td-r"><span class="td-k">${esc(k)}${src ? ` <span class="src">${esc(src)}</span>` : ""}</span>
      <span class="td-v" ${cls ? `style="color:${cls}"` : ""}>${v}</span></div>`;

  const specRows = [
    row("Phase", phaseBadge(phase), ""),
    row("Score / Rank", `${fnum(e.score, 2)} / #${e.lead?.rank ?? "—"}`, ""),
    row("Momentum", `${esc(e.lead?.trend || "—")} (short ${fnum(d.score_short, 1)})`,
      e.lead?.trend === "RISING" ? "var(--green)" : e.lead?.trend === "FADING" ? "var(--red)" : ""),
    row("Money flow", `${esc(mf)} (${fnum(d.money_flow_score, 3)} · p${fnum(d.money_flow_percentile, 0)})`, mfColorV),
    row("MA20 / MA50", `${fnum(ma20)} / ${fnum(ma50)}`, ""),
    row("MA200 / Prior-20H", `${fnum(ma200)} / ${fnum(d.prior_high_20)}`, ""),
    row("Stop reference", esc(e.stop_ref || "—"), "var(--amber)"),
    row("Peak / Drawdown", `${fnum(d.peak_price)} / ${fpctv(d.drawdown_pct)}`,
      (d.drawdown_pct ?? 0) < -15 ? "var(--red)" : "var(--amber)"),
    row("Exit risk", `${fnum(d.exit_risk_score, 0)} / 100`, vColor),
  ].join("");

  // gauges: C1 (ML, == tables), DDR (empirical, distinct), EML (per-ticker model, PROVISIONAL)
  const c1c = (c1 ?? 0) >= 0.4 ? "var(--red)" : (c1 ?? 0) >= 0.3 ? "var(--amber)" : "var(--txt)";
  const ddrc = (d.ddr_5d5pct ?? 0) >= 0.4 ? "var(--red)" : (d.ddr_5d5pct ?? 0) >= 0.25 ? "var(--amber)" : "var(--green)";
  const gauges = `
    <div class="td-gauge"><div class="g-num" style="color:${c1c}">${fprob(c1)}</div>
      <div class="g-d"><h4>Correction Risk</h4>
        <p>Short-term drop probability</p></div></div>
    <div class="td-gauge"><div class="g-num" style="color:${ddrc}">${fprob(d.ddr_5d5pct)}</div>
      <div class="g-d"><h4>Drawdown Risk <span class="tag">5d / -5%</span></h4>
        <p>Drawdown-profile base rate.</p></div></div>
    <div class="td-gauge"><div class="g-num" style="color:var(--amber)">${fprob(eml)}</div>
      <div class="g-d"><h4>Entry Quality <span class="tag prov">PROVISIONAL</span></h4>
        <p>Entry-quality model probability</p></div></div>`;

  // slider range + markers from real levels
  const levels = { Close: close, MA20: ma20, MA50: ma50, MA200: ma200, "Prior20H": d.prior_high_20, Peak: d.peak_price };
  const have = Object.values(levels).filter((v) => v != null);
  const lo = have.length ? Math.min(...have) * 0.96 : 0;
  const hi = have.length ? Math.max(...have) * 1.03 : 1;
  const span = (hi - lo) || 1;
  const pos = (v) => v == null ? null : Math.max(0, Math.min(100, (v - lo) / span * 100));
  // Place markers in priority order, skipping any that crowd an already-kept
  // label (<6% apart) so labels never overlap; align edge labels inward.
  const MIN_GAP = 3;
  const kept = [];
  for (const [n, v] of [["Close", close], ["MA20", ma20], ["MA50", ma50], ["MA200", ma200], ["Peak", d.peak_price]]) {
    const p = pos(v);
    if (p == null || kept.some((k) => Math.abs(k.p - p) < MIN_GAP)) continue;
    kept.push({ n, v, p });
  }
  kept.sort((a, b) => a.p - b.p);
  const lblTf = (p) => p < 8 ? "translateX(0)" : p > 92 ? "translateX(-100%)" : "translateX(-50%)";
  // Stagger labels onto two rows so adjacent ones never collide horizontally.
  const mkHtml = kept.map(({ n, v, p }, i) =>
    `<div class="td-mk" style="left:${p.toFixed(1)}%"><div class="ln"></div>` +
    `<div class="lb" style="top:${i % 2 ? 22 : 9}px;transform:${lblTf(p)}">${n} ${fnum(v)}</div></div>`).join("");

  _simCfg = { lo, hi, ma20, ma50, ma200, close };

  const sc = (zone, color, title, body, ref) =>
    `<div class="td-sc" data-zone="${zone}" style="border-left-color:${color}"><div class="t">
      <span>${title}</span><span class="tag">${zone}</span></div>
      <div class="b">${body}</div><div class="ref">${esc(ref)}</div></div>`;
  const scs = [
    sc("ABOVE_MA20", "var(--green)", "Reclaim & hold above MA20",
      `Holds above MA20 (${fnum(ma20)}). Constructive — typical: <b>EXIT_0_HOLD / EXIT_1_TIGHTEN</b>.`,
      `trigger: close >= MA20 ${fnum(ma20)}`),
    sc("MA50_MA20", "var(--teal)", "Between MA50 and MA20 (watch)",
      `Below MA20 (${fnum(ma20)}), above MA50 (${fnum(ma50)}). Tighten; no new buys. Typical: <b>EXIT_1_TIGHTEN</b>.`,
      `band: MA50 ${fnum(ma50)} .. MA20 ${fnum(ma20)}`),
    sc("MA200_MA50", "var(--amber)", "Between MA200 and MA50 (trim)",
      `Below MA50 (${fnum(ma50)}), above MA200 (${fnum(ma200)}). Reduce risk. Typical: <b>EXIT_2_TRIM</b>.`,
      `band: MA200 ${fnum(ma200)} .. MA50 ${fnum(ma50)}`),
    sc("BELOW_MA200", "var(--red)", "Below MA200 (breakdown)",
      `Breaks MA200 (${fnum(ma200)}). Major invalidation. Typical: <b>EXIT_3_EXIT / HARD_EXIT</b>.`,
      `trigger: close < MA200 ${fnum(ma200)}`),
  ].join("");

  return `
  <div class="td-top">
    <button class="pill td-back" onclick="window.__backDetail()">‹ Back</button>
    <h1 class="h1big" style="margin:0">${esc(tk)}</h1>
    <span class="pill" style="color:var(--amber);border-color:var(--amber)">${esc(d.trade_date || "—")}</span>
    <span class="subtle">entry_zone: <b>${esc(d.entry_zone || "—")}</b> · pullback <span style="color:${/MARKET_OFF|WAIT|REJECT|AVOID/.test(`${d.pullback_signal || ""} ${d.pullback_quality || ""}`) ? "var(--red)" : "var(--mut)"}">${esc(d.pullback_signal || "—")}/${esc(d.pullback_quality || "—")}</span></span>
  </div>

  <div class="td-grid">
    <div>
      <div class="panel">
        <div class="td-h">Profile context <span class="src">verified</span></div>
        <div class="td-pxr"><span class="td-pxl">Close</span><span class="td-px">${fnum(close)}</span></div>
        <div class="td-rows">${specRows}</div>
        <div class="td-verdict">
          <span class="td-vl">Live model verdict</span>
          <span class="td-vv" style="color:${vColor}">${esc(vLabel)}</span>
        </div>
      </div>
      <div class="panel" style="margin-top:14px">
        <div class="td-h">Quality indicators</div>
        ${gauges}
      </div>
    </div>

    <div>
      <div class="panel">
        <div class="td-h">Price-zone simulator <span class="tag deriv">DERIVED — not the live model</span></div>
        <div class="td-pxr"><span class="td-pxl">Simulated price</span><span class="td-px" id="simPx">${fnum(close)}</span></div>
        <input type="range" min="${lo.toFixed(2)}" max="${hi.toFixed(2)}" step="0.01"
          value="${(close ?? lo).toFixed(2)}" class="td-slider" id="td-sl">
        <div class="td-marks">${mkHtml}</div>
        <div class="td-verdict">
          <span class="td-vl">Zone (price-level heuristic)</span>
          <span class="td-vv" id="zoneVal" style="color:var(--amber)">—</span>
        </div>
        <div class="td-note"><strong>Read this right:</strong> the slider maps a hypothetical price onto real
          MA bands — a <strong>derived heuristic</strong>, not the model re-run (the model also uses money flow,
          candles, risk scores). The authoritative call is the <strong>Live model verdict</strong> on the left.
          <div class="td-disc">Disclaimer: For informational purposes only. Not investment advice.</div></div>
      </div>
      <div class="td-scs">${scs}</div>
    </div>
  </div>`;
}

function wireDetail() {
  const cfg = _simCfg;
  const sl = document.getElementById("td-sl");
  if (!cfg || !sl) return;
  const simPx = document.getElementById("simPx");
  const zoneVal = document.getElementById("zoneVal");
  const cards = [...document.querySelectorAll(".td-sc")];
  const COL = { ABOVE_MA20: "var(--green)", MA50_MA20: "var(--teal)", MA200_MA50: "var(--amber)", BELOW_MA200: "var(--red)" };
  const TXT = {
    ABOVE_MA20: "ABOVE MA20 · constructive", MA50_MA20: "MA50–MA20 · watch/tighten",
    MA200_MA50: "MA50 broken · trim", BELOW_MA200: "below MA200 · breakdown",
  };
  const zoneFor = (p) =>
    (cfg.ma20 != null && p >= cfg.ma20) ? "ABOVE_MA20"
      : (cfg.ma50 != null && p >= cfg.ma50) ? "MA50_MA20"
        : (cfg.ma200 != null && p >= cfg.ma200) ? "MA200_MA50" : "BELOW_MA200";
  const upd = (p) => {
    p = parseFloat(p);
    if (simPx) simPx.textContent = p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const z = zoneFor(p);
    if (zoneVal) { zoneVal.textContent = TXT[z]; zoneVal.style.color = COL[z]; }
    sl.style.setProperty("--zc", COL[z]);
    cards.forEach((c) => c.classList.toggle("on", c.dataset.zone === z));
  };
  sl.addEventListener("input", (ev) => upd(ev.target.value));
  upd(sl.value);
}

window.__backDetail = function () { location.hash = _lastBase || "cockpit"; };

/* ---------- router ---------- */
let _lastBase = "cockpit";
const ROUTES = {
  cockpit: { label: "Cockpit", render: renderCockpit },
  valuation: { label: "Valuation", render: renderValuation },
  portfolio: { label: "Portfolio", render: () => renderManager("PORTFOLIO") },
  watchlist: { label: "Watchlist", render: () => renderManager("WATCHLIST") },
  login: { label: "Log in", render: () => renderLogin() },
};

/* ---------- auth + CRUD handlers (global, called from inline onclick) ---------- */
let _authMode = "signin";
window.__authMode = function (m) {
  _authMode = m;
  document.querySelectorAll(".auth-tab").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
  const btn = document.getElementById("auth-submit");
  if (btn) btn.textContent = m === "signup" ? "Sign up" : "Sign in";
};
window.__authSubmit = function (e) {
  e.preventDefault();
  (async () => {
    const client = supa();
    const msg = document.getElementById("auth-msg");
    if (!client) { if (msg) msg.textContent = "Supabase chưa sẵn sàng."; return; }
    const email = document.getElementById("auth-email").value.trim();
    const pass = document.getElementById("auth-pass").value;
    if (msg) { msg.style.color = "var(--mut)"; msg.textContent = "…"; }
    const fn = _authMode === "signup" ? "signUp" : "signInWithPassword";
    const { data, error } = await client.auth[fn]({ email, password: pass });
    if (error) { if (msg) { msg.style.color = "var(--red)"; msg.textContent = error.message; } return; }
    if (_authMode === "signup" && !data.session) {
      if (msg) { msg.style.color = "var(--green)"; msg.textContent = "Đã tạo tài khoản — kiểm tra email xác nhận rồi đăng nhập."; }
      return;
    }
    // onAuthStateChange will refresh header + view
  })();
  return false;
};
window.__logout = async function () {
  const client = supa();
  if (client) await client.auth.signOut();
};
window.__addItem = function (e, kind) {
  e.preventDefault();
  (async () => {
    const client = supa();
    const msg = document.getElementById("mgr-msg");
    const ticker = document.getElementById("add-ticker").value.trim().toUpperCase();
    if (!ticker) return;
    const { error } = await client.from("tracked_items").insert({ kind, ticker });
    if (error) { if (msg) { msg.style.color = "var(--red)"; msg.textContent = error.message; } return; }
    navigate(kind === "PORTFOLIO" ? "portfolio" : "watchlist");
  })();
  return false;
};
window.__delItem = function (id) {
  (async () => {
    const client = supa();
    await client.from("tracked_items").delete().eq("id", id);
    navigate(location.hash.slice(1) || "portfolio");
  })();
};

function setActiveTab(route) {
  document.querySelectorAll("nav.tabs button").forEach((b) =>
    b.classList.toggle("active", b.dataset.route === route));
}

async function navigate(route) {
  const view = document.getElementById("view");
  if (route && route.indexOf("t/") === 0) {
    const tk = decodeURIComponent(route.slice(2)).trim().toUpperCase();
    setActiveTab(_lastBase);
    view.innerHTML = `<div class="status-line">Loading ${esc(tk)}…</div>`;
    try {
      view.innerHTML = await renderTickerDetail(tk);
      wireDetail();
      window.scrollTo(0, 0);
    } catch (e) {
      view.innerHTML = `<div class="status-line" style="color:var(--red)">Failed to load ${esc(tk)}: ${esc(e.message)}</div>`;
    }
    return;
  }
  const r = ROUTES[route] ? route : "cockpit";
  _lastBase = r;
  setActiveTab(r);
  view.innerHTML = `<div class="status-line">Loading ${esc(ROUTES[r].label)}…</div>`;
  try {
    view.innerHTML = await ROUTES[r].render();
  } catch (e) {
    view.innerHTML = `<div class="status-line" style="color:var(--red)">Failed to load data: ${esc(e.message)}</div>`;
  }
}

async function initHeader() {
  try {
    const m = await getJSON("latest.json");
    document.getElementById("fresh-text").textContent = `as_of ${m.as_of_date} · ${m.status}`;
    if (m.warnings && m.warnings.length) document.getElementById("fresh").title = m.warnings.join("\n");
  } catch (_) {
    document.getElementById("fresh-text").textContent = "data not ready";
  }
}

function updateAuthUI() {
  const btn = document.getElementById("acct-btn");
  if (!btn) return;
  btn.textContent = currentUser ? (currentUser.email || "Account") : "LOG IN";
}

async function initAuth() {
  const client = supa();
  if (!client) return;
  try {
    const { data } = await client.auth.getSession();
    currentUser = data.session ? data.session.user : null;
  } catch (_) { currentUser = null; }
  updateAuthUI();
  client.auth.onAuthStateChange((_evt, session) => {
    currentUser = session ? session.user : null;
    updateAuthUI();
    navigate(location.hash.slice(1) || "cockpit");
  });
}

async function wire() {
  document.querySelectorAll("[data-route]").forEach((b) =>
    b.addEventListener("click", () => { location.hash = b.dataset.route; }));
  // Click any ticker cell/chip -> open its detail (deep-link #t/<TICKER>).
  document.getElementById("view").addEventListener("click", (e) => {
    const el = e.target.closest(".tk,[data-tk]");
    if (!el) return;
    const tk = (el.dataset.tk || el.textContent || "").trim().toUpperCase();
    if (tk) location.hash = "t/" + encodeURIComponent(tk);
  });
  window.addEventListener("hashchange", () => navigate(location.hash.slice(1)));
  initHeader();
  await initAuth();
  navigate(location.hash.slice(1) || "cockpit");
}
document.addEventListener("DOMContentLoaded", wire);
