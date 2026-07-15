/* ui-expenses.js — 고정지출: 테마(대분류)·K-IFRS 계정과목 이중 분류, 그룹 표 + 도넛 + 모달.
   인건비는 salary_total 한 줄 고정(삭제·추가 불가). */
(function () {
  "use strict";
  const S = STORE.S;
  let editingId = null;
  let view = "theme"; // "theme"(테마별) | "account"(계정과목별)

  function groupKey(e) {
    if (view === "account") return e.account || STORE.THEME_TO_ACCOUNT[e.category || "기타"] || "기타판매비와관리비";
    return e.category || "기타";
  }
  function canonicalList() { return view === "account" ? STORE.ACCOUNTS : STORE.CATEGORIES; }

  // 이번 달 값 기준 그룹 목록 + 색 배정: 상위 5그룹은 차트 팔레트(정본 순서대로), 나머지는 웜그레이
  function groupStats() {
    const ym = STORE.nowYm();
    const map = {};
    S.expenses.forEach(function (e) {
      const k = groupKey(e);
      map[k] = (map[k] || 0) + CALC.monthlyFixedCost([e], ym);
    });
    const keys = canonicalList().filter(function (k) { return map[k] != null; })
      .concat(Object.keys(map).filter(function (k) { return canonicalList().indexOf(k) < 0; }));
    const byValue = keys.slice().sort(function (a, b) { return map[b] - map[a]; });
    const top5 = byValue.slice(0, 5);
    const colors = {};
    let ci = 0;
    keys.forEach(function (k) {
      colors[k] = top5.indexOf(k) >= 0 ? CHARTS.chartColor(ci++) : "var(--chart-cost)";
    });
    return { keys: keys, values: map, colors: colors };
  }

  function render() {
    renderViewToggle();
    const g = groupStats();
    renderTable(g);
    renderDonut(g);
  }

  function renderViewToggle() {
    const box = document.getElementById("expViewSel");
    if (!box) return;
    box.innerHTML =
      "<button class='scn-chip" + (view === "theme" ? " on" : "") + "' data-v='theme'>테마별</button>" +
      "<button class='scn-chip" + (view === "account" ? " on" : "") + "' data-v='account'>계정과목별 (K-IFRS)</button>";
    box.querySelectorAll("[data-v]").forEach(function (b) {
      b.addEventListener("click", function () { view = b.getAttribute("data-v"); render(); });
    });
  }

  function renderTable(g) {
    const tbl = document.getElementById("expTable");
    const ym = STORE.nowYm();
    let html = "<thead><tr><th>항목</th><th>월 환산</th><th>주기</th><th>메모</th><th></th></tr></thead><tbody>";

    const hasSalary = S.expenses.some(function (e) { return e.id === STORE.SALARY_ID; });
    let total = 0;

    g.keys.forEach(function (grp) {
      const items = S.expenses.filter(function (e) { return groupKey(e) === grp; });
      if (!items.length) return;
      let sub = 0;
      items.forEach(function (e) {
        const m = CALC.expenseMonthly(e);
        const activeNow = CALC.monthlyFixedCost([e], ym) > 0 || (!e.startMonth && !e.endMonth);
        sub += CALC.monthlyFixedCost([e], ym);
        // 반대편 분류를 작은 배지로 함께 표시 (테마 보기 → 계정과목, 계정과목 보기 → 테마)
        const other = view === "account" ? (e.category || "기타")
          : (e.account || STORE.THEME_TO_ACCOUNT[e.category || "기타"] || "");
        html += "<tr data-id='" + e.id + "'>" +
          "<td><span class='cat-dot' style='background:" + g.colors[grp] + "'></span>" +
          esc(e.name) +
          (e.id === STORE.SALARY_ID ? " <span class='badge dim'>합계만</span>" : "") +
          (!activeNow ? " <span class='badge dim'>기간 외</span>" : "") +
          (other ? "<div class='upd-by'>" + esc(other) + "</div>" : "") + "</td>" +
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
        html += "<tr class='subtotal'><td>" + esc(grp) + " 소계</td><td class='num'>" + CALC.fmtWon(sub) + "</td><td colspan='3'></td></tr>";
      }
    });
    html += "<tr class='total'><td>월 고정지출 합계</td><td class='num'>" + CALC.fmtWon(total) + "</td><td colspan='3'></td></tr>";
    html += "</tbody>";
    tbl.innerHTML = html;
    document.getElementById("expTotalNote").textContent = "· 이번 달 기준 " + CALC.fmtWonShort(total);

    if (!hasSalary && S.refs) STORE.saveExpense(STORE.defaultSalary());

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

  function renderDonut(g) {
    // 상위 5그룹 + 나머지는 '기타 묶음'으로 합쳐 표시 (색 순환 금지 원칙)
    const entries = g.keys.map(function (k) { return { label: k, value: g.values[k], color: g.colors[k] }; })
      .filter(function (it) { return it.value > 0; })
      .sort(function (a, b) { return b.value - a.value; });
    const top = entries.slice(0, 5);
    const rest = entries.slice(5);
    if (rest.length) {
      top.push({
        label: "그 외 " + rest.length + "개",
        value: rest.reduce(function (a, b) { return a + b.value; }, 0),
        color: "var(--chart-cost)"
      });
    }
    CHARTS.donut(document.getElementById("expDonut"), top.map(function (it, i) {
      return { label: it.label, value: it.value, colorIdx: i, fixedColor: it.color };
    }));
    document.getElementById("expLegend").innerHTML = CHARTS.legendHtml(
      top.map(function (it) { return { label: it.label + " " + CALC.fmtWonShort(it.value), color: it.color }; })
    );
  }

  // ---- 모달 ----
  function openModal(id) {
    editingId = id || null;
    const e = id ? S.expenses.find(function (x) { return x.id === id; }) : null;
    document.getElementById("expModalTitle").textContent = e ? "지출 수정" : "지출 추가";
    const catSel = document.getElementById("emCat");
    const accSel = document.getElementById("emAccount");
    const isSalary = e && e.id === STORE.SALARY_ID;
    catSel.innerHTML = STORE.CATEGORIES
      .filter(function (c) { return isSalary ? true : c !== "인건비"; })
      .map(function (c) { return "<option" + (e && e.category === c ? " selected" : "") + ">" + c + "</option>"; }).join("");
    catSel.disabled = !!isSalary;
    const curAcc = e ? (e.account || STORE.THEME_TO_ACCOUNT[e.category || "기타"]) : STORE.THEME_TO_ACCOUNT[catSel.value];
    accSel.innerHTML = STORE.ACCOUNTS
      .map(function (a) { return "<option" + (a === curAcc ? " selected" : "") + ">" + a + "</option>"; }).join("");
    accSel.disabled = !!isSalary;
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
      account: document.getElementById("emAccount").value,
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
    // 테마 바꾸면 계정과목 추천 자동 반영
    document.getElementById("emCat").addEventListener("change", function () {
      const rec = STORE.THEME_TO_ACCOUNT[this.value];
      if (rec) document.getElementById("emAccount").value = rec;
    });
  }

  window.UI_EXPENSES = { render: render, init: init, esc: esc, groupStats: groupStats };
})();
