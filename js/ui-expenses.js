/* ui-expenses.js — 고정지출: 카테고리 그룹 표 + 도넛 + 추가/수정 모달.
   인건비는 salary_total 한 줄 고정(삭제·추가 불가). */
(function () {
  "use strict";
  const S = STORE.S;
  let editingId = null;

  function render() {
    renderTable();
    renderDonut();
  }

  function renderTable() {
    const tbl = document.getElementById("expTable");
    const ym = STORE.nowYm();
    let html = "<thead><tr><th>항목</th><th>월 환산</th><th>주기</th><th>메모</th><th></th></tr></thead><tbody>";

    // 인건비 합계 행이 없으면 안내 행으로 초대
    const hasSalary = S.expenses.some(function (e) { return e.id === STORE.SALARY_ID; });

    let total = 0;
    STORE.CATEGORIES.forEach(function (cat, ci) {
      const items = S.expenses.filter(function (e) { return (e.category || "기타") === cat; });
      if (!items.length) return;
      let sub = 0;
      items.forEach(function (e) {
        const m = CALC.expenseMonthly(e);
        const active = CALC.monthlyFixedCost([e], ym) > 0 || !e.startMonth && !e.endMonth;
        sub += CALC.monthlyFixedCost([e], ym);
        html += "<tr data-id='" + e.id + "'>" +
          "<td><span class='cat-dot' style='background:" + CHARTS.chartColor(ci) + "'></span>" +
          esc(e.name) + (e.id === STORE.SALARY_ID ? " <span class='badge dim'>합계만</span>" : "") +
          (!active ? " <span class='badge dim'>기간 외</span>" : "") + "</td>" +
          "<td class='num'>" + CALC.fmtWon(m) + (e.cycle === "yearly" ? "<div class='upd-by'>연 " + CALC.fmtWonShort(e.amount) + "</div>" : "") + "</td>" +
          "<td>" + (e.cycle === "yearly" ? "연 1회" : "매달") + "</td>" +
          "<td style='max-width:180px; overflow:hidden; text-overflow:ellipsis;'>" + esc(e.memo || "") +
          (e.updatedBy ? "<div class='upd-by'>" + esc(e.updatedBy) + " 수정</div>" : "") + "</td>" +
          "<td><span class='row-actions'>" +
          "<button class='icon-btn' data-edit='" + e.id + "' title='수정'>✎</button>" +
          (e.id !== STORE.SALARY_ID ? "<button class='icon-btn' data-del='" + e.id + "' title='삭제'>✕</button>" : "") +
          "</span></td></tr>";
      });
      total += sub;
      if (items.length > 1) {
        html += "<tr class='subtotal'><td>" + cat + " 소계</td><td class='num'>" + CALC.fmtWon(sub) + "</td><td colspan='3'></td></tr>";
      }
    });
    html += "<tr class='total'><td>월 고정지출 합계</td><td class='num'>" + CALC.fmtWon(total) + "</td><td colspan='3'></td></tr>";
    html += "</tbody>";
    tbl.innerHTML = html;
    document.getElementById("expTotalNote").textContent = "· 이번 달 기준 " + CALC.fmtWonShort(total);

    if (!hasSalary && S.refs) {
      // 최초 1회 인건비 합계 행 자동 생성
      STORE.saveExpense(STORE.defaultSalary());
    }

    tbl.querySelectorAll("[data-edit]").forEach(function (b) {
      b.addEventListener("click", function () { openModal(b.getAttribute("data-edit")); });
    });
    tbl.querySelectorAll("[data-del]").forEach(function (b) {
      b.addEventListener("click", function () {
        const e = S.expenses.find(function (x) { return x.id === b.getAttribute("data-del"); });
        if (e && confirm("‘" + e.name + "’ 지출을 삭제할까요?")) {
          STORE.deleteExpense(e.id).then(function () { MAIN.toast("삭제했어요"); });
        }
      });
    });
  }

  function renderDonut() {
    const ym = STORE.nowYm();
    const items = [];
    STORE.CATEGORIES.forEach(function (cat, ci) {
      const v = CALC.monthlyFixedCost(S.expenses.filter(function (e) { return (e.category || "기타") === cat; }), ym);
      if (v > 0) items.push({ label: cat, value: v, colorIdx: ci });
    });
    CHARTS.donut(document.getElementById("expDonut"), items);
    document.getElementById("expLegend").innerHTML = CHARTS.legendHtml(
      items.map(function (it) { return { label: it.label + " " + CALC.fmtWonShort(it.value), color: CHARTS.chartColor(it.colorIdx) }; })
    );
  }

  // ---- 모달 ----
  function openModal(id) {
    editingId = id || null;
    const e = id ? S.expenses.find(function (x) { return x.id === id; }) : null;
    document.getElementById("expModalTitle").textContent = e ? "지출 수정" : "지출 추가";
    const catSel = document.getElementById("emCat");
    const isSalary = e && e.id === STORE.SALARY_ID;
    // 인건비 카테고리는 salary_total 외 추가 불가
    catSel.innerHTML = STORE.CATEGORIES
      .filter(function (c) { return isSalary ? true : c !== "인건비"; })
      .map(function (c) { return "<option" + (e && e.category === c ? " selected" : "") + ">" + c + "</option>"; }).join("");
    catSel.disabled = !!isSalary;
    document.getElementById("emName").value = e ? e.name : "";
    document.getElementById("emName").disabled = !!isSalary;
    document.getElementById("emAmount").value = e ? e.amount : "";
    document.getElementById("emCycle").value = e ? (e.cycle || "monthly") : "monthly";
    document.getElementById("emMemo").value = e ? (e.memo || "") : "";
    document.getElementById("emStart").value = e ? (e.startMonth || "") : "";
    document.getElementById("emEnd").value = e ? (e.endMonth || "") : "";
    MAIN.openOverlay("expModal");
  }

  function save() {
    const name = document.getElementById("emName").value.trim();
    const amount = Number(document.getElementById("emAmount").value) || 0;
    if (!name) { MAIN.toast("항목 이름을 입력해 주세요"); return; }
    const base = editingId ? S.expenses.find(function (x) { return x.id === editingId; }) : null;
    const exp = Object.assign({}, base || {}, {
      id: editingId || STORE.newId("exp"),
      name: name,
      category: document.getElementById("emCat").value,
      amount: amount,
      cycle: document.getElementById("emCycle").value,
      memo: document.getElementById("emMemo").value.trim(),
      startMonth: document.getElementById("emStart").value || null,
      endMonth: document.getElementById("emEnd").value || null,
      order: base ? (base.order || 0) : S.expenses.length
    });
    STORE.saveExpense(exp).then(function () {
      MAIN.closeOverlays(); MAIN.toast("저장했어요");
    }).catch(function (e) { MAIN.toast("저장 실패: " + e.message); });
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function init() {
    document.getElementById("expAddBtn").addEventListener("click", function () { openModal(null); });
    document.getElementById("emSave").addEventListener("click", save);
  }

  window.UI_EXPENSES = { render: render, init: init, esc: esc };
})();
