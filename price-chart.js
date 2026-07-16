/* US AI Stock Agent — price chart module (framework-free).
   Renders candles + MA20/50/200 + volume + Volume Profile (POC / VAH / VAL) for one
   ticker on the Ticker Detail panel, using the vendored TradingView Lightweight Charts
   v4.2.3 global (`window.LightweightCharts`).

   Display-only. Renders the frozen bars/<TICKER>.json feed as-is; recomputes no signal.
   The Volume Profile is an EOD approximation (no intraday ticks): each daily bar spreads
   its share volume evenly across the price bins its high–low range spans.

   Spec: docs/specs/deployment/ticker-detail-price-chart-spec-v1.md
   Public API:
     window.mountPriceChart(container, bars, opts) -> { destroy() }
     window.computeVP(win)  (exported for tests / reuse)
*/
"use strict";

(function () {
  const VP_BINS = 28;
  const VA_PCT = 0.70;
  const MA = { ma20: "#2DD4BF", ma50: "#F5C842", ma200: "#FF6B6B" };
  const UP = "#52E67A", DOWN = "#FF6B6B";
  const GOLD = "245,200,66"; // Volume Profile accent (rgb, alpha applied per use)

  /* ---- Volume Profile: real POC + contiguous 70% Value Area (VAH/VAL) ---- */
  function computeVP(win) {
    if (!win || !win.length) return null;
    let lo = Infinity, hi = -Infinity;
    win.forEach((b) => {
      if (b.low != null && b.low < lo) lo = b.low;
      if (b.high != null && b.high > hi) hi = b.high;
    });
    if (!(hi > lo)) return null;

    const bins = new Array(VP_BINS).fill(0);
    let total = 0;
    win.forEach((b) => {
      const v = b.volume || 0;
      if (!v || b.low == null || b.high == null) return;
      const b0 = Math.max(0, Math.min(VP_BINS - 1, Math.floor((b.low - lo) / (hi - lo) * VP_BINS)));
      const b1 = Math.max(0, Math.min(VP_BINS - 1, Math.floor((b.high - lo) / (hi - lo) * VP_BINS)));
      const per = v / (b1 - b0 + 1);
      for (let i = b0; i <= b1; i++) bins[i] += per;
      total += v;
    });
    if (!total) return null;

    let poc = 0;
    for (let i = 1; i < VP_BINS; i++) if (bins[i] > bins[poc]) poc = i;

    // Expand contiguously outward from POC until >= 70% of total volume.
    let l = poc, u = poc, acc = bins[poc];
    const target = total * VA_PCT;
    while (acc < target && (l > 0 || u < VP_BINS - 1)) {
      const above = u < VP_BINS - 1 ? bins[u + 1] : -1;
      const below = l > 0 ? bins[l - 1] : -1;
      if (above < 0 && below < 0) break;
      if (above >= below) { u += 1; acc += bins[u]; }   // tie -> upper (standard convention)
      else { l -= 1; acc += bins[l]; }
    }

    const step = (hi - lo) / VP_BINS;
    return {
      lo, hi, step, bins, total, poc, max: bins[poc],
      vaLow: l, vaHigh: u,
      valPrice: lo + l * step,
      vahPrice: lo + (u + 1) * step,
      pocPrice: lo + (poc + 0.5) * step,
      inVA: (i) => i >= l && i <= u,
    };
  }

  /* ---- VP overlay as a series primitive (right-aligned, below candles) ---- */
  function makeVP(calc) {
    const prim = { _series: null };
    prim.attached = (p) => { prim._series = p.series; };
    prim.detached = () => { prim._series = null; };
    prim.paneViews = () => [{
      // Draw OVER the candles (semi-transparent, like a TradingView fixed-range
      // profile) so the gold histogram is actually visible instead of hidden behind
      // the price action on the right edge.
      zOrder: () => "top",
      renderer: () => ({
        draw: (target) => target.useMediaCoordinateSpace((scope) => {
          const s = prim._series;
          if (!s || !calc) return;
          const ctx = scope.context, W = scope.mediaSize.width;
          const maxW = Math.round(W * 0.30);
          for (let i = 0; i < VP_BINS; i++) {
            if (!calc.bins[i]) continue;
            const y1 = s.priceToCoordinate(calc.lo + i * calc.step);
            const y2 = s.priceToCoordinate(calc.lo + (i + 1) * calc.step);
            if (y1 == null || y2 == null) continue;
            const top = Math.min(y1, y2), h = Math.max(1, Math.abs(y1 - y2) - 1);
            const bw = Math.max(1, calc.bins[i] / calc.max * maxW);
            ctx.fillStyle = i === calc.poc ? `rgba(${GOLD},0.72)`
              : calc.inVA(i) ? `rgba(${GOLD},0.46)`
                : `rgba(${GOLD},0.26)`;
            ctx.fillRect(W - bw, top, bw, h); // right-aligned
          }
          const hline = (price, alpha, dash, width, label) => {
            const y = s.priceToCoordinate(price);
            if (y == null) return;
            ctx.strokeStyle = `rgba(${GOLD},${alpha})`;
            ctx.setLineDash(dash); ctx.lineWidth = width || 1;
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
            ctx.setLineDash([]);
            if (label) {
              ctx.font = "10px ui-monospace,monospace";
              ctx.fillStyle = `rgba(${GOLD},${Math.min(1, alpha + 0.1)})`;
              ctx.fillText(label, 4, y - 3);
            }
          };
          hline(calc.pocPrice, 0.90, [4, 3], 1.5, "POC"); // brightest
          hline(calc.vahPrice, 0.55, [2, 4], 1, "VAH");
          hline(calc.valPrice, 0.55, [2, 4], 1, "VAL");
        }),
      }),
    }];
    return prim;
  }

  /* ---- Mount ---- */
  function mountPriceChart(container, bars, opts) {
    opts = opts || {};
    const LC = opts.LC || window.LightweightCharts;
    const presets = opts.presets || [63, 126, 252];
    let preset = opts.preset || 126;

    // Clear + guard: fail-soft on missing / too-short history.
    container.innerHTML = "";
    if (!LC) {
      container.innerHTML = '<div class="pc-note">Chart library failed to load.</div>';
      return { destroy() { container.innerHTML = ""; } };
    }
    if (!bars || bars.length < 20) {
      container.innerHTML = '<div class="pc-note">Not enough price history to draw a chart.</div>';
      return { destroy() { container.innerHTML = ""; } };
    }

    // Header: MA legend + preset buttons + display-only note.
    const head = document.createElement("div");
    head.className = "pc-head";
    const legend =
      `<span class="pc-lg" style="color:${MA.ma20}">MA20</span>` +
      `<span class="pc-lg" style="color:${MA.ma50}">MA50</span>` +
      `<span class="pc-lg" style="color:${MA.ma200}">MA200</span>` +
      `<span class="pc-basis">SMA(adjusted close)</span>`;
    const btns = presets.map((p) =>
      `<button class="pc-preset${p === preset ? " on" : ""}" data-p="${p}">${p}</button>`).join("");
    head.innerHTML = `<div class="pc-legend">${legend}</div><div class="pc-presets">${btns}</div>`;
    container.appendChild(head);

    const chartEl = document.createElement("div");
    chartEl.className = "pc-canvas";
    container.appendChild(chartEl);

    const foot = document.createElement("div");
    foot.className = "pc-foot";
    foot.textContent = "display-only · Volume Profile approximated from EOD bars (allocated across each bar's high–low range) · POC/VAH/VAL";
    container.appendChild(foot);

    let chart = null;

    // Explicit sizing (autoSize measures width 0 on the first paint before layout
    // flushes, leaving the canvas 0px wide). We size from clientWidth and keep it
    // responsive with a ResizeObserver below.
    const sizeOf = () => ({
      width: chartEl.clientWidth || Math.round(chartEl.getBoundingClientRect().width) || 600,
      height: chartEl.clientHeight || 360,
    });
    const ro = new ResizeObserver(() => { if (chart) chart.applyOptions(sizeOf()); });
    ro.observe(chartEl);

    function render() {
      if (chart) { chart.remove(); chart = null; }
      const win = bars.slice(-preset);
      const sz = sizeOf();

      chart = LC.createChart(chartEl, {
        width: sz.width, height: sz.height,
        layout: { background: { type: "solid", color: "transparent" }, textColor: "#8A919C", fontSize: 11 },
        grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
        rightPriceScale: { borderColor: "rgba(255,255,255,0.10)" },
        timeScale: { borderColor: "rgba(255,255,255,0.10)", rightOffset: 3 },
      });

      const candles = chart.addCandlestickSeries({
        upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
        borderVisible: false, priceLineVisible: false,
      });
      candles.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.24 } });

      const vol = chart.addHistogramSeries({
        priceScaleId: "vol", priceFormat: { type: "volume" },
        lastValueVisible: false, priceLineVisible: false,
      });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 }, visible: false });

      const mk = (c) => chart.addLineSeries({
        color: c, lineWidth: 1.5, priceLineVisible: false,
        lastValueVisible: false, crosshairMarkerVisible: false,
      });
      const m20 = mk(MA.ma20), m50 = mk(MA.ma50), m200 = mk(MA.ma200);

      candles.setData(win.map((b) => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c })));
      vol.setData(win.map((b) => ({
        time: b.t, value: b.v || 0,
        color: b.c < b.o ? "rgba(255,107,107,0.28)" : "rgba(82,230,122,0.28)",
      })));
      const line = (k) => win.filter((b) => b[k] != null).map((b) => ({ time: b.t, value: b[k] }));
      m20.setData(line("ma20")); m50.setData(line("ma50")); m200.setData(line("ma200"));

      // computeVP takes {high,low,volume}; the feed uses short keys (h/l/v) -> map.
      const vp = computeVP(win.map((b) => ({ high: b.h, low: b.l, volume: b.v })));
      if (vp) candles.attachPrimitive(makeVP(vp));

      chart.timeScale().fitContent();
    }

    // Preset switching re-mounts the chart (cheap; avoids stateful primitive mutation).
    function onHeadClick(ev) {
      const b = ev.target.closest(".pc-preset");
      if (!b) return;
      const p = Number(b.dataset.p);
      if (p === preset) return;
      preset = p;
      head.querySelectorAll(".pc-preset").forEach((x) =>
        x.classList.toggle("on", Number(x.dataset.p) === preset));
      render();
    }
    head.addEventListener("click", onHeadClick);

    // Render synchronously (do NOT defer to requestAnimationFrame — rAF is paused in
    // hidden/background tabs, which would leave the chart unrendered). sizeOf() has a
    // non-zero fallback, and the ResizeObserver above corrects the width once layout
    // flushes (ResizeObserver fires regardless of tab visibility).
    render();

    return {
      destroy() {
        head.removeEventListener("click", onHeadClick);
        ro.disconnect();
        if (chart) { chart.remove(); chart = null; }
        container.innerHTML = "";
      },
    };
  }

  window.computeVP = computeVP;
  window.mountPriceChart = mountPriceChart;
})();
