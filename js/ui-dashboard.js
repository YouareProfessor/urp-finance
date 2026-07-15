/* ui-dashboard.js — 대시보드: KPI 3카드 + 12개월 미니 차트 + 지출 상위 카테고리. */
(function () {
  "use strict";
  const S = STORE.S;
  const esc = function (s) { return UI_EXPENSES.esc(s); };

  function render() {
    const sc = STORE.activeScenario();
    const kpiRow = document.getElementById("kpiRow");
    const nowYm = STORE.nowYm();

    if (!sc) {
      kpiRow.innerHTML = "<div class='card'>시나리오를 만들면 여기에 재무 현황이 나타나요. ‘수익 시뮬레이터’ 탭에서 시작하세요.</div>";
      document.getElementById("dashChart").innerHTML = "";
      document.getElementById("dashTopCats").innerHTML = "";
      return;
    }

    const rows = CALC.pnlSeries(sc, S.expenses, S.actuals, S.settings);
    const be = CALC.breakEven(rows);
    const rw = CALC.runwayInfo(rows, S.settings, nowYm);
    const nowRow = rows.find(function (r) { return r.ym === nowYm; }) || rows[0];

    // 월 흑자까지 매출 갭
    const gap = nowRow ? Math.max(0, nowRow.cost - nowRow.revenue) : 0;

    document.getElementById("dashSub").textContent =
      "기준 시나리오: " + sc.name + " · 오늘 " + CALC.ymLabel(nowYm) + " · 팀 모두에게 같은 화면이 보입니다.";

    kpiRow.innerHTML =
      kpi("이번 달 손익", CALC.fmtWonShort(nowRow ? nowRow.profit : 0),
        nowRow && nowRow.profit >= 0 ? "pos" : "neg",
        "매출 " + CALC.fmtWonShort(nowRow ? nowRow.revenue : 0) + " − 지출 " + CALC.fmtWonShort(nowRow ? nowRow.cost : 0),
        nowRow && nowRow.isActual ? "<span class='badge pos'>실적</span>" : "<span class='badge dim'>추정</span>", "pnl") +
      kpi("런웨이", CALC.fmtMonths(rw.months),
        rw.months !== Infinity && rw.months < 6 ? "neg" : "",
        "현금 <b id='cashEdit' style='cursor:pointer; border-bottom:1px dashed var(--muted);'>" +
        CALC.fmtWonShort(S.settings.cashBalance || 0) + "</b> · 월 순유출 " + CALC.fmtWonShort(Math.max(0, rw.burn)),
        rw.cashOutYm ? "<span class='badge neg'>" + CALC.ymLabel(rw.cashOutYm) + " 소진</span>" : "<span class='badge pos'>여유</span>", null) +
      kpi("월 흑자까지", be.monthlyBE ? CALC.ymLabel(be.monthlyBE) : "기간 내 없음",
        be.monthlyBE ? "pos" : "neg",
        gap > 0 ? "월 매출 " + CALC.fmtWonShort(gap) + " 더 필요해요" : "이미 월 흑자예요",
        null, "simulator");

    // KPI 클릭 → 탭 이동
    kpiRow.querySelectorAll(".kpi[data-go]").forEach(function (k) {
      k.addEventListener("click", function (ev) {
        if (ev.target.id === "cashEdit") return;
        MAIN.goTab(k.getAttribute("data-go"));
      });
    });
    // 현금잔고 인라인 수정
    const cashEl = document.getElementById("cashEdit");
    if (cashEl) cashEl.addEventListener("click", function (ev) {
      ev.stopPropagation();
      const v = prompt("현재 현금 잔고를 입력하세요 (원)", S.settings.cashBalance || 0);
      if (v === null) return;
      STORE.saveSettings({ cashBalance: Number(String(v).replace(/[^0-9.-]/g, "")) || 0, cashAsOf: STORE.nowYm() })
        .then(function () { MAIN.toast("현금 잔고를 갱신했어요"); });
    });

    // 12개월 미니 차트
    const rows12 = rows.slice(0, 12);
    CHARTS.comboChart(document.getElementById("dashChart"), rows12, { breakEven: be.monthlyBE });
    document.getElementById("dashChartScn").textContent = "· " + sc.name;
    document.getElementById("dashLegend").innerHTML = CHARTS.legendHtml([
      { label: "매출", color: "var(--chart-1)" },
      { label: "고정지출", color: "var(--chart-cost)" },
      { label: "누적손익", color: "var(--ink)", line: true }
    ]);

    // 지출 상위 3 그룹 (고정지출 탭과 같은 색 배정 재사용)
    const g = UI_EXPENSES.groupStats();
    const cats = g.keys.map(function (k) { return { cat: k, v: g.values[k], color: g.colors[k] }; })
      .filter(function (c) { return c.v > 0; })
      .sort(function (a, b) { return b.v - a.v; });
    const total = cats.reduce(function (a, c) { return a + c.v; }, 0);
    document.getElementById("dashTopCats").innerHTML = cats.length === 0
      ? "<p class='mini-note'>아직 등록된 지출이 없어요. ‘고정지출’ 탭에서 추가하세요.</p>"
      : cats.slice(0, 3).map(function (c) {
        const pct = Math.round(c.v / total * 100);
        return "<div style='margin-bottom:16px;'>" +
          "<div style='display:flex; justify-content:space-between; font-size:13.5px; font-weight:600;'>" +
          "<span><span class='cat-dot' style='background:" + c.color + "'></span>" + esc(c.cat) + "</span>" +
          "<span class='num'>" + CALC.fmtWonShort(c.v) + " · " + pct + "%</span></div>" +
          "<div style='height:8px; border-radius:4px; background:var(--paper2); margin-top:7px; overflow:hidden;'>" +
          "<div style='height:100%; width:" + pct + "%; border-radius:4px; background:" + c.color + "; transition:width .8s var(--e);'></div></div></div>";
      }).join("") +
      "<button class='btn ghost sm' onclick=\"MAIN.goTab('expenses')\">전체 보기 →</button>";

    function kpi(lb, v, vCls, d, tag, go) {
      return "<div class='kpi'" + (go ? " data-go='" + go + "'" : " style='cursor:default;'") + ">" +
        (tag ? "<span class='tag'>" + tag + "</span>" : "") +
        "<div class='lb'>" + lb + "</div><div class='v " + (vCls || "") + " num'>" + v + "</div>" +
        "<div class='d'>" + d + "</div></div>";
    }
  }

  window.UI_DASH = { render: render, init: function () {} };
})();
