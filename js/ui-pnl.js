/* ui-pnl.js — 월별 손익표: 표(실적 인라인 입력) + 메인 콤보 차트. */
(function () {
  "use strict";
  const S = STORE.S;
  const esc = function (s) { return UI_EXPENSES.esc(s); };
  let pnlScnId = null; // 손익표 탭 전용 선택 (기본: 활성 시나리오)

  function currentScn() {
    return S.scenarios.find(function (sc) { return sc.id === pnlScnId; }) || STORE.activeScenario();
  }

  function render() {
    renderSelectors();
    const sc = currentScn();
    const tbl = document.getElementById("pnlTable");
    const chartBox = document.getElementById("pnlChart");
    if (!sc) { tbl.innerHTML = ""; chartBox.innerHTML = "<p class='mini-note'>시나리오를 먼저 만들어 주세요.</p>"; return; }

    const horizon = S.settings.horizonMonths || 24;
    const scH = Object.assign({}, sc, { months: Math.min(horizon, sc.months || 24) });
    const rows = CALC.pnlSeries(scH, S.expenses, S.actuals, S.settings);
    const be = CALC.breakEven(rows);

    CHARTS.comboChart(chartBox, rows, { breakEven: be.monthlyBE });
    document.getElementById("pnlLegend").innerHTML = CHARTS.legendHtml([
      { label: "매출", color: "var(--chart-1)" },
      { label: "고정지출", color: "var(--chart-cost)" },
      { label: "누적손익", color: "var(--ink)", line: true },
      { label: "월 흑자 전환점", color: "var(--pos)" }
    ]);

    let html = "<thead><tr><th>월</th><th>매출</th><th>고정지출</th><th>순손익</th><th>누적손익</th><th>현금잔고</th><th></th></tr></thead><tbody>";
    rows.forEach(function (r) {
      html += "<tr data-ym='" + r.ym + "'>" +
        "<td>" + CALC.ymLabel(r.ym) + (r.isActual ? " <span class='badge pos'>실적</span>" : "") + "</td>" +
        "<td class='num'>" + CALC.fmtWon(r.revenue) + "</td>" +
        "<td class='num'>" + CALC.fmtWon(r.cost) + "</td>" +
        "<td class='num " + (r.profit >= 0 ? "pos" : "neg") + "'>" + CALC.fmtWon(r.profit) + "</td>" +
        "<td class='num " + (r.cum >= 0 ? "pos" : "neg") + "'>" + CALC.fmtWon(r.cum) + "</td>" +
        "<td class='num'>" + (r.cash != null ? CALC.fmtWon(r.cash) : "-") + "</td>" +
        "<td><span class='row-actions'><button class='icon-btn' data-act='" + r.ym + "' title='실적 입력'>✎</button></span></td></tr>";
    });
    html += "</tbody>";
    tbl.innerHTML = html;

    tbl.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function () { editActual(b.getAttribute("data-act")); });
    });
  }

  function renderSelectors() {
    const scnBox = document.getElementById("pnlScnSel");
    scnBox.innerHTML = S.scenarios.map(function (sc) {
      const on = sc.id === (currentScn() && currentScn().id);
      return "<button class='scn-chip" + (on ? " on" : "") + "' data-id='" + sc.id + "' style='margin-right:6px;'>" +
        "<span class='sw' style='background:" + CHARTS.chartColor(sc.color || 0) + "'></span>" + esc(sc.name) + "</button>";
    }).join("");
    scnBox.querySelectorAll("[data-id]").forEach(function (b) {
      b.addEventListener("click", function () { pnlScnId = b.getAttribute("data-id"); render(); });
    });

    const hBox = document.getElementById("pnlHorizonSel");
    hBox.innerHTML = [12, 18, 24].map(function (h) {
      const on = (S.settings.horizonMonths || 24) === h;
      return "<button class='scn-chip" + (on ? " on" : "") + "' data-h='" + h + "' style='margin-right:6px;'>" + h + "개월</button>";
    }).join("");
    hBox.querySelectorAll("[data-h]").forEach(function (b) {
      b.addEventListener("click", function () {
        STORE.saveSettings({ horizonMonths: Number(b.getAttribute("data-h")) });
        render();
      });
    });
  }

  function editActual(ym) {
    const cur = S.actuals[ym] || {};
    const rev = prompt(CALC.ymLabel(ym) + " 실제 매출을 입력하세요 (원).\n비우면 실적을 지우고 추정으로 돌아갑니다.",
      cur.revenue != null ? cur.revenue : "");
    if (rev === null) return; // 취소
    if (rev.trim() === "") {
      STORE.saveActual(ym, null).then(function () { MAIN.toast("실적을 지웠어요 — 추정으로 표시됩니다"); });
      return;
    }
    const costS = prompt("실제 지출도 있다면 입력하세요 (원). 비우면 고정지출 추정을 그대로 씁니다.",
      cur.costOverride != null ? cur.costOverride : "");
    const data = { revenue: Number(rev.replace(/[^0-9.-]/g, "")) || 0 };
    if (costS !== null && costS.trim() !== "") data.costOverride = Number(costS.replace(/[^0-9.-]/g, "")) || 0;
    STORE.saveActual(ym, data).then(function () { MAIN.toast("실적을 저장했어요"); });
  }

  window.UI_PNL = { render: render, init: function () {} };
})();
