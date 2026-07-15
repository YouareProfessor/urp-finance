/* ui-simulator.js — 수익 시뮬레이터: 시나리오 칩 + 스트림 슬라이더 + 즉시 재계산 + 비교 모드. */
(function () {
  "use strict";
  const S = STORE.S;
  const esc = function (s) { return UI_EXPENSES.esc(s); };

  const PARAMS = [
    { key: "price", label: "인당 가격 (원/월)", min: 0, max: 100000, step: 500, fmt: function (v) { return CALC.fmtWon(v); } },
    { key: "users", label: "예상 사용자 수 (명)", min: 0, max: 50000, step: 50, fmt: function (v) { return v.toLocaleString("ko-KR") + "명"; } },
    { key: "conv", label: "유료 전환율", min: 0, max: 1, step: 0.01, fmt: function (v) { return Math.round(v * 100) + "%"; } },
    { key: "growth", label: "월 성장률", min: 0, max: 0.3, step: 0.005, fmt: function (v) { return (Math.round(v * 1000) / 10) + "%/월"; } },
    { key: "startOffset", label: "시작 시점 (개월 뒤)", min: 0, max: 23, step: 1, fmt: function (v) { return v + "개월 뒤"; } }
  ];

  function render() {
    renderChips();
    if (S.compareOn) { renderCompare(); } else { renderEditor(); renderResult(); }
  }

  // ---- 시나리오 칩 ----
  function renderChips() {
    const box = document.getElementById("scnChips");
    let html = "";
    S.scenarios.forEach(function (sc) {
      const on = S.compareOn ? S.compareIds.indexOf(sc.id) >= 0 : sc.id === S.settings.activeScenarioId;
      html += "<button class='scn-chip" + (on ? (S.compareOn ? " cmp" : " on") : "") + "' data-id='" + sc.id + "'>" +
        "<span class='sw' style='background:" + CHARTS.chartColor(sc.color || 0) + "'></span>" + esc(sc.name) + "</button>";
    });
    html += "<button class='scn-chip' id='scnAdd'>+ 새 시나리오</button>";
    box.innerHTML = html;

    box.querySelectorAll(".scn-chip[data-id]").forEach(function (b) {
      b.addEventListener("click", function () {
        const id = b.getAttribute("data-id");
        if (S.compareOn) {
          const i = S.compareIds.indexOf(id);
          if (i >= 0) S.compareIds.splice(i, 1); else S.compareIds.push(id);
          render();
        } else {
          STORE.saveSettings({ activeScenarioId: id });
          S.settings.activeScenarioId = id;
          render();
        }
      });
    });
    const add = document.getElementById("scnAdd");
    if (add) add.addEventListener("click", function () {
      const sc = STORE.defaultScenario(S.scenarios.length);
      STORE.saveScenarioNow(sc).then(function () {
        STORE.saveSettings({ activeScenarioId: sc.id });
        MAIN.toast("새 시나리오를 만들었어요");
      });
    });

    const note = document.getElementById("cmpNote");
    note.textContent = S.compareOn ? "비교할 시나리오를 눌러 선택하세요 (" + S.compareIds.length + "개 선택됨)" : "";
    document.getElementById("cmpToggle").classList.toggle("primary", S.compareOn);
  }

  // ---- 편집 패널 (왼쪽) ----
  function renderEditor() {
    const sc = STORE.activeScenario();
    const left = document.getElementById("simLeft");
    if (!sc) {
      left.innerHTML = "<p class='mini-note'>아직 시나리오가 없어요. ‘+ 새 시나리오’를 눌러 시작하세요.</p>";
      document.getElementById("simRight").innerHTML = "";
      return;
    }
    let html = "<div style='display:flex; align-items:center; gap:8px; flex-wrap:wrap;'>" +
      "<h3 style='font-size:17px; flex:1;'>" + esc(sc.name) + "</h3>" +
      "<button class='btn ghost sm' id='scnRename'>이름·기간</button>" +
      "<button class='btn ghost sm' id='scnClone'>복제</button>" +
      "<button class='btn ghost sm' id='scnDel' style='color:var(--neg);'>삭제</button></div>" +
      "<p class='mini-note' style='margin-top:6px;'>" + sc.startMonth + " 시작 · " + sc.months + "개월" +
      (sc.updatedBy ? " · " + esc(sc.updatedBy) + " 수정" : "") + "</p>";

    (sc.streams || []).forEach(function (st, si) {
      html += "<div class='stream-card' data-si='" + si + "'>" +
        "<div class='st-head'><input value='" + esc(st.name) + "' data-p='name' />" +
        ((sc.streams.length > 1) ? "<button class='icon-btn' data-delstream='" + si + "'>✕</button>" : "") + "</div>";
      PARAMS.forEach(function (p) {
        const v = st[p.key] == null ? 0 : st[p.key];
        html += "<div class='param'><div class='p-lb'><span>" + p.label + "</span>" +
          "<input type='number' data-p='" + p.key + "' value='" + v + "' min='" + p.min + "' step='" + p.step + "' /></div>" +
          "<input type='range' data-p='" + p.key + "' value='" + v + "' min='" + p.min + "' max='" + p.max + "' step='" + p.step + "' /></div>";
      });
      html += "</div>";
    });
    html += "<div style='margin-top:14px;'><button class='btn sm' id='streamAdd'>+ 수익원 추가</button></div>";
    left.innerHTML = html;

    // 파라미터 바인딩 (range↔number 쌍, 즉시 재계산 + 디바운스 저장)
    left.querySelectorAll(".stream-card").forEach(function (cardEl) {
      const si = Number(cardEl.getAttribute("data-si"));
      cardEl.querySelectorAll("input[data-p]").forEach(function (inp) {
        inp.addEventListener("input", function () {
          const key = inp.getAttribute("data-p");
          const st = sc.streams[si];
          if (key === "name") { st.name = inp.value; }
          else {
            const v = Number(inp.value) || 0;
            st[key] = v;
            // 쌍둥이 입력 동기화
            cardEl.querySelectorAll("input[data-p='" + key + "']").forEach(function (twin) {
              if (twin !== inp) twin.value = v;
            });
          }
          STORE.saveScenarioDebounced(sc);
          renderResult();
        });
      });
      const del = cardEl.querySelector("[data-delstream]");
      if (del) del.addEventListener("click", function () {
        if (!confirm("이 수익원을 삭제할까요?")) return;
        sc.streams.splice(si, 1);
        STORE.saveScenarioNow(sc); render();
      });
    });

    document.getElementById("streamAdd").addEventListener("click", function () {
      sc.streams = sc.streams || [];
      sc.streams.push({ id: STORE.newId("st"), name: "수익원 " + (sc.streams.length + 1), price: 9900, users: 100, conv: 0.3, growth: 0.05, startOffset: 0 });
      STORE.saveScenarioNow(sc); render();
    });
    document.getElementById("scnRename").addEventListener("click", function () { openScnModal(sc); });
    document.getElementById("scnClone").addEventListener("click", function () {
      const copy = JSON.parse(JSON.stringify(sc));
      copy.id = STORE.newId("scn"); copy.name = sc.name + " (복제)";
      copy.order = S.scenarios.length; copy.color = S.scenarios.length % 5;
      STORE.saveScenarioNow(copy).then(function () {
        STORE.saveSettings({ activeScenarioId: copy.id });
        MAIN.toast("복제했어요");
      });
    });
    document.getElementById("scnDel").addEventListener("click", function () {
      if (S.scenarios.length <= 1) { MAIN.toast("마지막 시나리오는 삭제할 수 없어요"); return; }
      if (!confirm("‘" + sc.name + "’ 시나리오를 삭제할까요?")) return;
      STORE.deleteScenario(sc.id).then(function () {
        STORE.saveSettings({ activeScenarioId: null });
        MAIN.toast("삭제했어요");
      });
    });
  }

  // ---- 결과 패널 (오른쪽) ----
  function renderResult() {
    const sc = STORE.activeScenario();
    const right = document.getElementById("simRight");
    if (!sc) { right.innerHTML = ""; return; }
    const rows = CALC.pnlSeries(sc, S.expenses, S.actuals, S.settings);
    const be = CALC.breakEven(rows);
    const rw = CALC.runwayInfo(rows, S.settings);

    right.innerHTML =
      "<div class='card deep'><h3 style='font-size:16px;'>매출·손익 전망</h3>" +
      "<div class='chart-box' id='simChart' style='margin-top:12px;'></div>" +
      "<div class='legend' id='simLegend'></div></div>" +
      "<div class='card'><div class='kpis' style='grid-template-columns:repeat(3,1fr);'>" +
      kpi("월 흑자 전환", be.monthlyBE ? CALC.ymLabel(be.monthlyBE) : "기간 내 없음", be.monthlyBE ? "pos" : "neg") +
      kpi("누적 흑자", be.cumulativeBE ? CALC.ymLabel(be.cumulativeBE) : "기간 내 없음", be.cumulativeBE ? "pos" : "neg") +
      kpi("현금 소진", rw.cashOutYm ? CALC.ymLabel(rw.cashOutYm) : "없음", rw.cashOutYm ? "neg" : "pos") +
      "</div></div>";

    CHARTS.comboChart(document.getElementById("simChart"), rows, { breakEven: be.monthlyBE });
    document.getElementById("simLegend").innerHTML = CHARTS.legendHtml([
      { label: "매출", color: "var(--chart-1)" },
      { label: "고정지출", color: "var(--chart-cost)" },
      { label: "누적손익", color: "var(--ink)", line: true }
    ]);

    function kpi(lb, v, cls) {
      return "<div class='kpi' style='cursor:default; padding:16px 18px;'><div class='lb'>" + lb +
        "</div><div class='v " + (cls || "") + "' style='font-size:19px;'>" + v + "</div></div>";
    }
  }

  // ---- 비교 모드 ----
  function renderCompare() {
    const left = document.getElementById("simLeft");
    const right = document.getElementById("simRight");
    const picked = S.scenarios.filter(function (sc) { return S.compareIds.indexOf(sc.id) >= 0; });
    if (picked.length < 2) {
      left.innerHTML = "<p class='mini-note'>위 칩에서 비교할 시나리오를 2개 이상 선택하세요.</p>";
      right.innerHTML = "";
      return;
    }
    // 비교표
    let html = "<h3 style='font-size:16px;'>시나리오 비교</h3><div class='tbl-wrap' style='margin-top:10px;'><table><thead><tr><th>시나리오</th><th>12개월 누적 매출</th><th>월 흑자</th><th>현금 소진</th></tr></thead><tbody>";
    picked.forEach(function (sc) {
      const rows = CALC.pnlSeries(sc, S.expenses, S.actuals, S.settings);
      const be = CALC.breakEven(rows);
      const rw = CALC.runwayInfo(rows, S.settings);
      const rev12 = rows.slice(0, 12).reduce(function (a, r) { return a + r.revenue; }, 0);
      html += "<tr><td><span class='cat-dot' style='background:" + CHARTS.chartColor(sc.color || 0) + "'></span>" + esc(sc.name) + "</td>" +
        "<td class='num'>" + CALC.fmtWonShort(rev12) + "</td>" +
        "<td>" + (be.monthlyBE ? CALC.ymLabel(be.monthlyBE) : "-") + "</td>" +
        "<td>" + (rw.cashOutYm ? CALC.ymLabel(rw.cashOutYm) : "없음") + "</td></tr>";
    });
    html += "</tbody></table></div>";
    left.innerHTML = html;

    right.innerHTML = "<div class='card deep'><h3 style='font-size:16px;'>월 매출 비교</h3>" +
      "<div class='chart-box' id='cmpChart' style='margin-top:12px;'></div><div class='legend' id='cmpLegend'></div></div>";
    CHARTS.multiLine(document.getElementById("cmpChart"), picked.map(function (sc) {
      return {
        name: sc.name, colorIdx: sc.color || 0,
        points: CALC.scenarioSeries(sc).map(function (p) { return { ym: p.ym, v: p.revenue }; })
      };
    }));
    document.getElementById("cmpLegend").innerHTML = CHARTS.legendHtml(picked.map(function (sc) {
      return { label: sc.name, color: CHARTS.chartColor(sc.color || 0), line: true };
    }));
  }

  // ---- 시나리오 모달 ----
  let scnEditing = null;
  function openScnModal(sc) {
    scnEditing = sc;
    document.getElementById("scnModalTitle").textContent = "시나리오 설정";
    document.getElementById("smName").value = sc.name;
    document.getElementById("smStart").value = sc.startMonth;
    document.getElementById("smMonths").value = sc.months;
    MAIN.openOverlay("scnModal");
  }

  function init() {
    document.getElementById("cmpToggle").addEventListener("click", function () {
      S.compareOn = !S.compareOn;
      if (S.compareOn && !S.compareIds.length) {
        S.compareIds = S.scenarios.slice(0, 2).map(function (s) { return s.id; });
      }
      render();
    });
    document.getElementById("smSave").addEventListener("click", function () {
      if (!scnEditing) return;
      scnEditing.name = document.getElementById("smName").value.trim() || scnEditing.name;
      scnEditing.startMonth = document.getElementById("smStart").value || scnEditing.startMonth;
      scnEditing.months = Number(document.getElementById("smMonths").value) || 24;
      STORE.saveScenarioNow(scnEditing).then(function () {
        MAIN.closeOverlays(); MAIN.toast("저장했어요");
      });
    });
  }

  window.UI_SIM = { render: render, init: init };
})();
