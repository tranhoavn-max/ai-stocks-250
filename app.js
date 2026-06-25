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
  const p = c1 && (c1.c15_prob ?? c1.c15_prob_raw);
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
  CHEAP_WITH_STRENGTH: "var(--green)", CHEAP_BUT_WEAK: "var(--teal)", IN_LINE_WITH_LAYER: "var(--mut)",
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

function sparkline(vals, w = 140, h = 34) {
  if (!vals || vals.length < 2) return "";
  const min = Math.min(...vals), max = Math.max(...vals), rng = (max - min) || 1;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * w;
    const y = h - ((v - min) / rng) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const [lx, ly] = pts[pts.length - 1].split(",");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="overflow:visible" aria-hidden="true">
    <polyline points="${pts.join(" ")}" fill="none" stroke="var(--amber)" stroke-width="1.4"></polyline>
    <circle cx="${lx}" cy="${ly}" r="2.4" fill="var(--amber)"></circle></svg>`;
}

function goBoardSVG() {
  const lines = [];
  for (let p = 15; p <= 135; p += 15) {
    lines.push(`<line x1="${p}" y1="15" x2="${p}" y2="135"></line>`);
    lines.push(`<line x1="15" y1="${p}" x2="135" y2="${p}"></line>`);
  }
  const stone = (x, y, fill, stroke) =>
    `<circle cx="${x}" cy="${y}" r="6.5" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="1.4"` : ""}></circle>`;
  return `<svg width="150" height="150" viewBox="0 0 150 150" aria-label="Go board">
    <rect x="6" y="6" width="138" height="138" fill="#0a0a0a" stroke="#222"></rect>
    <g stroke="#2b2b2b" stroke-width=".8">${lines.join("")}</g>
    ${stone(45, 60, "#e2e2e2")}${stone(60, 75, "#e2e2e2")}${stone(45, 90, "#e2e2e2")}
    ${stone(75, 75, "#ff9e1b")}
    ${stone(90, 60, "#0a0a0a", "#6a6a6a")}${stone(90, 90, "#0a0a0a", "#6a6a6a")}${stone(60, 105, "#e2e2e2")}</svg>`;
}

window.__toggleGate = function () {
  const b = document.getElementById("gate-banner");
  const btn = document.getElementById("gate-toggle");
  if (!b || !btn) return;
  const off = b.style.display !== "none";
  b.style.display = off ? "none" : "";
  btn.textContent = `GATE: ${off ? "ON" : "OFF"} · toggle demo`;
};

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
    <td>${esc(r.setup_text || "—")}</td>
    <td class="subtle">${esc(r.stop_ref || "—")}</td>
    <td>${c1Cell(r.c1)}</td>
    <td class="subtle">${leadCell(r)}</td>
    <td>${phaseBadge(r.phase)}</td></tr>`).join("") ||
    `<tr><td colspan="7" class="subtle" style="padding:14px">No ENTRY trigger today.</td></tr>`;

  const ondeckRows = (d.continuation || []).map((r, i) => `<tr>
    <td class="r subtle">${i + 1}</td>
    <td class="tk">${esc(r.ticker)}</td>
    <td class="subtle">${esc(r.setup_text || "—")}</td>
    <td>${c1Cell(r.c1)}</td>
    <td style="color:var(--amber)">${esc(r.why_waiting || "—")}</td>
    <td class="subtle">${leadCell(r)}</td>
    <td>${phaseBadge(r.phase)}</td></tr>`).join("") ||
    `<tr><td colspan="7" class="subtle" style="padding:14px">No on-deck names.</td></tr>`;

  const mom = d.momentum;
  const momChips = mom ? mom.leaders.map((m) => {
    const star = m.is_entry ? `<span class="star">★</span> ` : "";
    const d1 = m.top_decile ? `<span class="d1">D1</span>` : "";
    let rk = m.risk_flags && m.risk_flags.length
      ? m.risk_flags.map((f) => `<span class="flag">${esc(f.label)}</span>`).join("")
      : (m.snapshot_clean ? `<span class="ok">✓</span>` : `<span class="unk">?</span>`);
    return `<span class="m">${star}<strong>${esc(m.ticker)}</strong> <span class="rs">RS${m.rs_pctl}</span>${d1}${rk}</span>`;
  }).join("") : `<span class="subtle">Momentum RS252 unavailable.</span>`;

  const gateColor = gate ? "var(--green)" : "var(--amber)";

  return `
  <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
    <h1 class="h1big">DECISION COCKPIT · US</h1>
    <div style="text-align:right">
      <span class="pill" style="color:var(--teal);border-color:var(--teal);background:rgba(45,212,191,.12)">COVERAGE ${esc(d.meta.coverage_status || "—")}</span>
      <div class="subtle" style="margin-top:5px">ENTRY=${d.counts.entry} · ON-DECK=${d.counts.continuation}</div>
    </div>
  </div>

  <div class="philo">
    <div style="flex:0 0 auto">${goBoardSVG()}</div>
    <div style="flex:1 1 280px;min-width:240px">
      <h2>GO BOARD PHILOSOPHY</h2>
      <ul>
        <li><span style="color:var(--amber)">▸ Move slowly.</span> Every move is a deliberate decision — don't chase price, don't rush in.</li>
        <li><span style="color:var(--green)">▸ Risk first.</span> Keep your liberties (liquidity &amp; stops) before claiming territory.</li>
        <li><span style="color:var(--teal)">▸ Play the whole board.</span> Read the entire market, don't cling to one corner.</li>
      </ul>
    </div>
  </div>

  <div class="cau">
    <div class="cau-head">
      <h2 style="margin:0;color:var(--amber);font-size:14px;text-transform:uppercase;letter-spacing:.06em">MARKET CAUTION</h2>
      <span class="pill" style="color:var(--amber);border-color:var(--amber);background:rgba(255,158,27,.12);text-transform:uppercase">${esc(mc.tier || "—")}</span>
      <span class="subtle">scale ELEVATED≥${mc.elevated_threshold ?? 60} · HIGH≥${mc.fire_threshold ?? 80}</span>
    </div>
    <div class="cau-body">
      <div style="line-height:1"><span class="cau-score">${mc.score ?? "—"}</span><span class="subtle" style="font-size:17px">/100</span></div>
      ${sparkline(d.caution_history)}
      ${d.caution_sessions ? `<span class="subtle" style="align-self:flex-end">${d.caution_sessions} sessions</span>` : ""}
    </div>
    <div class="chips">${chips}</div>
  </div>

  <div class="section-h" style="gap:12px">
    <h2>① New Triggers</h2>
    <button id="gate-toggle" class="gate-btn pill" style="color:${gateColor};border-color:${gateColor}" onclick="window.__toggleGate()">GATE: ${gate ? "ON" : "OFF"} · toggle demo</button>
  </div>
  <div id="gate-banner" class="banner-amber" style="${gate ? "display:none" : ""}">⚠ MARKET GATE: OFF (risk-off) — rows below are context (gate-off / early), not buy orders.</div>
  <div class="table-wrap"><table class="dc"><thead><tr>
    <th class="r">#</th><th>Ticker</th><th>Setup</th><th>Levels (Entry→Stop·Risk%)</th><th>C1</th><th>Lead</th><th>Phase</th>
  </tr></thead><tbody>${triggerRows}</tbody></table></div>

  <div class="section-h"><h2>🔥 Momentum Watch — RS252</h2>${mom ? `<span class="cnt">· top${mom.limit} · decile=${mom.decile_n} · cov ${mom.coverage[0]}/${mom.coverage[1]}</span>` : ""}</div>
  <div class="mom">${momChips}</div>

  <div class="section-h"><h2>② On-Deck — entering soon</h2><span class="cnt">· ${d.counts.continuation}</span></div>
  <div class="table-wrap"><table class="dc"><thead><tr>
    <th class="r">#</th><th>Ticker</th><th>Setup</th><th>C1</th><th>Blocker</th><th>Lead</th><th>Phase</th>
  </tr></thead><tbody>${ondeckRows}</tbody></table></div>`;
}

async function renderValuation() {
  const d = await getJSON("valuation-latest.json");
  const rows = [...(d.tickers || [])].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const tableRows = rows.map((r) => {
    const vs = r.pe_vs_layer_pct;
    const vsTxt = vs == null ? `<span class="subtle">—</span>`
      : `<span style="color:${vs < 0 ? "var(--green)" : "var(--amber)"}">${(vs * 100).toFixed(0)}%</span>`;
    const pe = r.pe_display != null ? `${r.pe_display.toFixed(2)} <span class="subtle">${(r.pe_type || "")[0] || ""}</span>` : `<span class="subtle">—</span>`;
    const lc = VAL_LABEL[r.valuation_label] || "var(--mut)";
    return `<tr>
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

  const legend = VAL_LEGEND.map(([k, t]) =>
    `<div class="row"><span class="pill" style="color:${VAL_LABEL[k]};border-color:${VAL_LABEL[k]};background:transparent;font-size:10px">${k}</span><span class="subtle">— ${t}</span></div>`).join("");

  return `
  <div><h1 class="h1big">P/E VALUATION LENS</h1>
    <div class="subtle" style="margin-top:4px">as_of ${esc(d.as_of_date)} · <strong style="color:var(--green)">FRESH</strong></div></div>
  <div class="panel">
    <div class="subtle" style="text-transform:uppercase;font-size:10.5px;letter-spacing:.05em;margin-bottom:8px">Legend</div>
    <div class="legend">${legend}</div>
  </div>
  <div class="table-wrap"><table class="dc"><thead><tr>
    <th>Ticker</th><th>Layer</th><th>Phase</th><th>MF</th><th class="r">Score</th><th class="r">P/E</th>
    <th class="r">Layer P/E</th><th class="r">vs Layer</th><th>Valuation Label</th>
  </tr></thead><tbody>${tableRows}</tbody></table></div>
  <div class="disclaimer">P/E so với median layer (median ưu tiên hơn trung bình) · ${d.valid_pe_count}/${d.ticker_count} mã có P/E · display-only, KHÔNG phải khuyến nghị.</div>`;
}

function renderLocked(title) {
  return `<div class="locked"><div class="lk-card">
    <h2>${esc(title)}</h2>
    <p class="subtle">Phần này riêng tư, cần đăng nhập. Sẽ kết nối <strong>Supabase</strong> (auth + lưu danh mục theo tài khoản) — đang phát triển.</p>
    <p class="subtle" style="margin-top:10px">Phần phân tích thị trường (Cockpit, Valuation) xem được không cần đăng nhập.</p>
  </div></div>`;
}

/* ---------- router ---------- */
const ROUTES = {
  cockpit: { label: "Cockpit", render: renderCockpit },
  valuation: { label: "Valuation", render: renderValuation },
  portfolio: { label: "Portfolio", render: () => renderLocked("Portfolio Manager") },
  watchlist: { label: "Watchlist", render: () => renderLocked("Watchlist Manager") },
  login: { label: "Đăng nhập", render: () => renderLocked("Đăng nhập") },
};

function setActiveTab(route) {
  document.querySelectorAll("nav.tabs button").forEach((b) =>
    b.classList.toggle("active", b.dataset.route === route));
}

async function navigate(route) {
  const r = ROUTES[route] ? route : "cockpit";
  setActiveTab(r);
  const view = document.getElementById("view");
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

function wire() {
  document.querySelectorAll("[data-route]").forEach((b) =>
    b.addEventListener("click", () => { location.hash = b.dataset.route; }));
  window.addEventListener("hashchange", () => navigate(location.hash.slice(1)));
  initHeader();
  navigate(location.hash.slice(1) || "cockpit");
}
document.addEventListener("DOMContentLoaded", wire);
