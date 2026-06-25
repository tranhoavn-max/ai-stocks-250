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
// Enrichment map ticker -> {layer, phase, score, mf} from the public valuation feed.
let _enrich = null;
async function enrichMap() {
  if (_enrich) return _enrich;
  _enrich = {};
  try {
    const v = await getJSON("valuation-latest.json");
    for (const r of v.tickers || []) {
      _enrich[r.ticker] = { layer: r.ai_layer_code, phase: r.phase_code, score: r.score, mf: r.money_flow_state };
    }
  } catch (_) {}
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

async function renderManager(kind) {
  if (!currentUser) return renderLogin("Đăng nhập để xem " + kind + ".");
  const client = supa();
  const [items, em] = await Promise.all([
    client.from("tracked_items").select("*").eq("kind", kind).order("sort_order").order("created_at"),
    enrichMap(),
  ]);
  if (items.error) return `<div class="status-line" style="color:var(--red)">Lỗi: ${esc(items.error.message)}</div>`;
  const rows = (items.data || []).map((it) => {
    const e = em[it.ticker] || {};
    return `<tr>
      <td class="tk">${esc(it.ticker)}</td>
      <td class="subtle" style="font-size:11px">${esc(e.layer || "—")}</td>
      <td>${phaseBadge(e.phase)}</td>
      <td class="r">${e.score != null ? e.score.toFixed(1) : "—"}</td>
      <td style="color:${mfColor(e.mf)};font-size:11px">${esc(e.mf || "—")}</td>
      <td class="r"><button class="row-del" title="Delete" onclick="window.__delItem('${it.id}')">✕</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="subtle" style="padding:14px">Chưa có mã — thêm mã đầu tiên.</td></tr>`;

  return `
  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
    <h1 class="h1big">${kind === "PORTFOLIO" ? "PORTFOLIO" : "WATCHLIST"} MANAGER</h1>
  </div>
  <form class="add-form" onsubmit="return window.__addItem(event,'${kind}')" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
    <input class="auth-input grow" id="add-ticker" placeholder="Ticker" required style="text-transform:uppercase;max-width:140px" />
    <button class="acct-btn" type="submit">Add</button>
  </form>
  <div id="mgr-msg" class="subtle" style="min-height:14px"></div>
  <div class="table-wrap"><table class="dc"><thead><tr>
    <th>Ticker</th><th>Layer</th><th>Phase</th><th class="r">Score</th><th>MF</th><th class="r"></th>
  </tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* ---------- router ---------- */
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
  window.addEventListener("hashchange", () => navigate(location.hash.slice(1)));
  initHeader();
  await initAuth();
  navigate(location.hash.slice(1) || "cockpit");
}
document.addEventListener("DOMContentLoaded", wire);
