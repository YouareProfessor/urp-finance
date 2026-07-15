/* charts.js — 수제 SVG 차트 3종 (콤보/멀티라인/도넛).
   규칙: 축 1개, 얇은 마크, 색은 var(--chart-*) 토큰만, 호버 툴팁 기본. */
(function () {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  function el(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function chartColor(i) { return css("--chart-" + ((i % 5) + 1)); }

  // ---- 툴팁 싱글턴 ----
  const tip = { node: null };
  function tipShow(html, x, y) {
    if (!tip.node) tip.node = document.getElementById("chartTip");
    tip.node.innerHTML = html;
    tip.node.classList.add("on");
    const w = tip.node.offsetWidth, h = tip.node.offsetHeight;
    let px = x + 14, py = y - h - 10;
    if (px + w > innerWidth - 8) px = x - w - 14;
    if (py < 8) py = y + 14;
    tip.node.style.left = px + "px"; tip.node.style.top = py + "px";
  }
  function tipHide() { if (tip.node) tip.node.classList.remove("on"); }

  function niceScale(min, max) {
    if (min === max) { max = min + 1; }
    const span = max - min;
    const step = Math.pow(10, Math.floor(Math.log10(span / 4)));
    const err = span / 4 / step;
    const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
    const s = step * mult;
    return { min: Math.floor(min / s) * s, max: Math.ceil(max / s) * s, step: s };
  }

  const W = 720, H = 300, PAD = { t: 16, r: 14, b: 30, l: 58 };

  function frame(container) {
    container.innerHTML = "";
    const svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "img" });
    container.appendChild(svg);
    return svg;
  }

  function yAxis(svg, scale, yPos) {
    for (let v = scale.min; v <= scale.max + 1e-9; v += scale.step) {
      const y = yPos(v);
      svg.appendChild(el("line", { x1: PAD.l, x2: W - PAD.r, y1: y, y2: y, class: v === 0 ? "zero-line" : "grid-line" }));
      const t = el("text", { x: PAD.l - 8, y: y + 4, "text-anchor": "end", class: "axis" });
      t.textContent = CALC.fmtWonShort(v);
      const g = el("g", { class: "axis" }); g.appendChild(t); svg.appendChild(g);
    }
  }

  function xLabels(svg, rows, xPos) {
    const every = Math.ceil(rows.length / 8);
    rows.forEach(function (r, i) {
      if (i % every !== 0) return;
      const t = el("text", { x: xPos(i), y: H - 8, "text-anchor": "middle", class: "axis" });
      t.textContent = CALC.ymLabel(r.ym);
      const g = el("g", { class: "axis" }); g.appendChild(t); svg.appendChild(g);
    });
  }

  // ============ 콤보: 매출/지출 막대 + 누적손익 선 (동일 ₩축) ============
  function comboChart(container, rows, opts) {
    opts = opts || {};
    const svg = frame(container);
    if (!rows.length) return;
    let lo = 0, hi = 0;
    rows.forEach(function (r) {
      lo = Math.min(lo, r.profit, r.cum, 0);
      hi = Math.max(hi, r.revenue, r.cost, r.cum, 0);
    });
    const sc = niceScale(lo, hi);
    const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
    const yPos = function (v) { return PAD.t + plotH * (1 - (v - sc.min) / (sc.max - sc.min)); };
    const slot = plotW / rows.length;
    const barW = Math.max(3, Math.min(12, (slot - 6) / 2));
    const xPos = function (i) { return PAD.l + slot * (i + 0.5); };

    yAxis(svg, sc, yPos);
    const y0 = yPos(0);

    rows.forEach(function (r, i) {
      const cx = xPos(i);
      // 매출 막대 (chart-1), 지출 막대 (chart-cost) — 2px 간격, 윗단 라운드
      [{ v: r.revenue, c: css("--chart-1"), dx: -barW - 1 }, { v: r.cost, c: css("--chart-cost"), dx: 1 }]
        .forEach(function (b) {
          if (b.v <= 0) return;
          const y = yPos(b.v);
          svg.appendChild(el("path", {
            d: roundedBar(cx + b.dx, y, barW, y0 - y, 4),
            fill: b.c, opacity: r.isActual ? 1 : 0.82
          }));
        });
    });

    // 누적손익 선 (잉크색 2px)
    const line = rows.map(function (r, i) { return (i ? "L" : "M") + xPos(i) + " " + yPos(r.cum); }).join(" ");
    svg.appendChild(el("path", { d: line, fill: "none", stroke: css("--ink"), "stroke-width": 2, "stroke-linejoin": "round" }));

    // 분기점 마커
    if (opts.breakEven) {
      const idx = rows.findIndex(function (r) { return r.ym === opts.breakEven; });
      if (idx >= 0) {
        svg.appendChild(el("circle", { cx: xPos(idx), cy: yPos(rows[idx].cum), r: 5, fill: css("--pos"), stroke: css("--card"), "stroke-width": 2 }));
      }
    }
    xLabels(svg, rows, xPos);
    hoverLayer(svg, container, rows, xPos, function (r) {
      return "<div class='t'>" + CALC.ymLabel(r.ym) + (r.isActual ? " · 실적" : " · 추정") + "</div>" +
        row("매출", r.revenue) +
        (r.isActual || r.fixed == null
          ? row("비용", r.cost)
          : row("고정지출", r.fixed) + (r.api ? row("API 원가", r.api) : "") + (r.fee ? row("결제 수수료", r.fee) : "")) +
        row("순손익", r.profit) + row("누적손익", r.cum) +
        (r.cash != null ? row("현금잔고", r.cash) : "");
    });
    function row(k, v) {
      return "<div class='r'><span class='k'>" + k + "</span><span class='num'>" + CALC.fmtWon(v) + "</span></div>";
    }
  }

  function roundedBar(x, y, w, h, r) {
    if (h <= 0) return "M0 0";
    r = Math.min(r, w / 2, h);
    return "M" + x + " " + (y + h) +
      " L" + x + " " + (y + r) +
      " Q" + x + " " + y + " " + (x + r) + " " + y +
      " L" + (x + w - r) + " " + y +
      " Q" + (x + w) + " " + y + " " + (x + w) + " " + (y + r) +
      " L" + (x + w) + " " + (y + h) + " Z";
  }

  // ============ 멀티라인: 시나리오 비교 ============
  // seriesArr: [{name, colorIdx, points:[{ym, v}]}] — 모든 시리즈 동일 개월 축이 아니어도 ym 합집합으로 그림
  function multiLine(container, seriesArr) {
    const svg = frame(container);
    if (!seriesArr.length) return;
    const yms = Array.from(new Set(seriesArr.flatMap(function (s) { return s.points.map(function (p) { return p.ym; }); }))).sort();
    let lo = 0, hi = 0;
    seriesArr.forEach(function (s) { s.points.forEach(function (p) { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); }); });
    const sc = niceScale(lo, hi);
    const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
    const yPos = function (v) { return PAD.t + plotH * (1 - (v - sc.min) / (sc.max - sc.min)); };
    const xPos = function (i) { return PAD.l + (yms.length === 1 ? plotW / 2 : plotW * i / (yms.length - 1)); };
    yAxis(svg, sc, yPos);

    seriesArr.forEach(function (s) {
      const map = {}; s.points.forEach(function (p) { map[p.ym] = p.v; });
      let d = "", started = false;
      yms.forEach(function (ym, i) {
        if (map[ym] == null) return;
        d += (started ? " L" : "M") + xPos(i) + " " + yPos(map[ym]); started = true;
      });
      svg.appendChild(el("path", { d: d, fill: "none", stroke: chartColor(s.colorIdx), "stroke-width": 2, "stroke-linejoin": "round" }));
      // 직접 라벨 (끝점)
      const last = s.points[s.points.length - 1];
      if (last) {
        const t = el("text", { x: Math.min(xPos(yms.indexOf(last.ym)) + 6, W - 4), y: yPos(last.v) + 4, class: "axis", "font-weight": "700" });
        t.textContent = s.name;
        t.style.fill = chartColor(s.colorIdx);
        const g = el("g", { class: "axis" }); g.appendChild(t); svg.appendChild(g);
      }
    });
    xLabels(svg, yms.map(function (ym) { return { ym: ym }; }), xPos);
    hoverLayer(svg, container, yms.map(function (ym) { return { ym: ym }; }), xPos, function (r) {
      let html = "<div class='t'>" + CALC.ymLabel(r.ym) + "</div>";
      seriesArr.forEach(function (s) {
        const p = s.points.find(function (q) { return q.ym === r.ym; });
        if (p) html += "<div class='r'><span class='k'>" + s.name + "</span><span class='num'>" + CALC.fmtWon(p.v) + "</span></div>";
      });
      return html;
    });
  }

  // ============ 도넛: 지출 카테고리 ============
  function donut(container, items) {
    container.innerHTML = "";
    const size = 240, cx = size / 2, cy = size / 2, r = 88, thick = 30;
    const svg = el("svg", { viewBox: "0 0 " + size + " " + size });
    container.appendChild(svg);
    const total = items.reduce(function (a, b) { return a + b.value; }, 0);
    if (total <= 0) {
      svg.appendChild(el("circle", { cx: cx, cy: cy, r: r, fill: "none", stroke: css("--line"), "stroke-width": thick }));
    } else {
      let a0 = -Math.PI / 2;
      items.forEach(function (it, i) {
        const frac = it.value / total;
        // 360° 완전 원은 시작점=끝점이라 그려지지 않음 — 미세하게 줄여서 그림
        const a1 = Math.min(a0 + frac * Math.PI * 2, a0 + Math.PI * 2 - 0.003);
        // 2px 간격: 표면색 스트로크
        const fillColor = it.fixedColor
          ? (it.fixedColor.indexOf("var(") === 0 ? css(it.fixedColor.slice(4, -1)) : it.fixedColor)
          : chartColor(it.colorIdx != null ? it.colorIdx : i);
        svg.appendChild(el("path", {
          d: arcPath(cx, cy, r, a0, a1, thick),
          fill: fillColor,
          stroke: css("--card"), "stroke-width": 2
        })).addEventListener("mousemove", function (ev) {
          tipShow("<div class='t'>" + it.label + "</div><div class='r'><span class='k'>월 환산</span><span class='num'>" +
            CALC.fmtWon(it.value) + "</span></div><div class='r'><span class='k'>비중</span><span class='num'>" +
            Math.round(frac * 100) + "%</span></div>", ev.clientX, ev.clientY);
        });
        a0 = a1;
      });
      svg.addEventListener("mouseleave", tipHide);
    }
    const t1 = el("text", { x: cx, y: cy - 4, "text-anchor": "middle", "font-size": "20", "font-weight": "800" });
    t1.textContent = CALC.fmtWonShort(total);
    t1.style.fill = css("--ink");
    const t2 = el("text", { x: cx, y: cy + 18, "text-anchor": "middle", "font-size": "11" });
    t2.textContent = "월 고정지출";
    t2.style.fill = css("--muted");
    svg.appendChild(t1); svg.appendChild(t2);
  }

  function arcPath(cx, cy, r, a0, a1, thick) {
    const r2 = r - thick;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = function (rr, a) { return (cx + rr * Math.cos(a)) + " " + (cy + rr * Math.sin(a)); };
    return "M" + p(r, a0) + " A" + r + " " + r + " 0 " + large + " 1 " + p(r, a1) +
      " L" + p(r2, a1) + " A" + r2 + " " + r2 + " 0 " + large + " 0 " + p(r2, a0) + " Z";
  }

  // ---- 호버 레이어 (세로 크로스헤어 + 툴팁) ----
  function hoverLayer(svg, container, rows, xPos, htmlFor) {
    const cross = el("line", { y1: PAD.t, y2: H - PAD.b, stroke: css("--muted"), "stroke-width": 1, "stroke-dasharray": "3 3", opacity: 0 });
    svg.appendChild(cross);
    const overlay = el("rect", { x: PAD.l, y: PAD.t, width: W - PAD.l - PAD.r, height: H - PAD.t - PAD.b, fill: "transparent" });
    svg.appendChild(overlay);
    overlay.addEventListener("mousemove", function (ev) {
      const rect = svg.getBoundingClientRect();
      const mx = (ev.clientX - rect.left) * (W / rect.width);
      let best = 0, bd = Infinity;
      rows.forEach(function (_, i) {
        const d = Math.abs(xPos(i) - mx);
        if (d < bd) { bd = d; best = i; }
      });
      cross.setAttribute("x1", xPos(best)); cross.setAttribute("x2", xPos(best));
      cross.setAttribute("opacity", 1);
      tipShow(htmlFor(rows[best]), ev.clientX, ev.clientY);
    });
    overlay.addEventListener("mouseleave", function () { cross.setAttribute("opacity", 0); tipHide(); });
  }

  function legendHtml(items) {
    return items.map(function (it) {
      return "<span class='li'><span class='sw" + (it.line ? " line" : "") + "' style='background:" + it.color + "'></span>" + it.label + "</span>";
    }).join("");
  }

  window.CHARTS = { comboChart: comboChart, multiLine: multiLine, donut: donut, legendHtml: legendHtml, chartColor: chartColor, tipHide: tipHide };
})();
