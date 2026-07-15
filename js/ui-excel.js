/* ui-excel.js — 엑셀 탭: 내보내기 버튼 + 가져오기(미리보기·열 매핑·반영). */
(function () {
  "use strict";
  const S = STORE.S;
  const esc = function (s) { return UI_EXPENSES.esc(s); };
  let parsed = null;

  function render() { /* 정적 화면 — 상태 변화 없음 */ }

  function init() {
    document.getElementById("exportBtn").addEventListener("click", function () {
      XLSX_IO.exportWorkbook().then(function (name) {
        MAIN.toast("‘" + name + "’ 파일로 저장했어요");
      }).catch(function (e) { MAIN.toast(e.message); });
    });

    const drop = document.getElementById("dropZone");
    const fileInput = document.getElementById("fileInput");
    drop.addEventListener("click", function () { fileInput.click(); });
    fileInput.addEventListener("change", function () {
      if (fileInput.files.length) handleFile(fileInput.files[0]);
    });
    ["dragover", "dragenter"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); });
    });
    drop.addEventListener("drop", function (e) {
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
  }

  function handleFile(file) {
    XLSX_IO.parseFile(file).then(function (p) {
      parsed = p;
      renderMapping();
    }).catch(function (e) { MAIN.toast(e.message); });
  }

  function renderMapping() {
    const area = document.getElementById("importArea");
    const cols = parsed.headers.map(function (h, i) { return { i: i, h: h || ("열 " + (i + 1)) }; });
    function sel(key, required) {
      return "<select data-map='" + key + "'>" +
        (required ? "" : "<option value='-1'>사용 안 함</option>") +
        cols.map(function (c) {
          return "<option value='" + c.i + "'" + (parsed.guess[key] === c.i ? " selected" : "") + ">" + esc(c.h) + "</option>";
        }).join("") + "</select>";
    }
    area.innerHTML =
      "<p class='mini-note' style='margin-top:16px;'>‘" + esc(parsed.sheetName) + "’ 시트에서 " + parsed.rows.length + "행을 찾았어요. 열을 확인해 주세요.</p>" +
      "<div class='map-row'><span>항목 이름</span>" + sel("name", true) + "</div>" +
      "<div class='map-row'><span>금액</span>" + sel("amount", true) + "</div>" +
      "<div class='map-row'><span>카테고리</span>" + sel("category") + "</div>" +
      "<div class='map-row'><span>주기</span>" + sel("cycle") + "</div>" +
      "<div class='map-row'><span>메모</span>" + sel("memo") + "</div>" +
      "<div class='prev-tbl'><table id='prevTable'></table></div>" +
      "<label style='display:flex; align-items:center; gap:8px; margin-top:14px; font-size:13.5px;'>" +
      "<input type='checkbox' id='impReplace' /> 기존 지출을 지우고 교체 (인건비 합계는 유지)</label>" +
      "<div style='margin-top:14px; display:flex; gap:8px;'>" +
      "<button class='btn primary' id='impCommit'>반영하기 <span class='arr'>→</span></button>" +
      "<button class='btn ghost' id='impCancel'>취소</button></div>";

    area.querySelectorAll("select[data-map]").forEach(function (s) {
      s.addEventListener("change", renderPreview);
    });
    document.getElementById("impCancel").addEventListener("click", function () {
      parsed = null; area.innerHTML = "";
    });
    document.getElementById("impCommit").addEventListener("click", commit);
    renderPreview();
  }

  function currentMap() {
    const map = {};
    document.querySelectorAll("#importArea select[data-map]").forEach(function (s) {
      map[s.getAttribute("data-map")] = Number(s.value);
    });
    return map;
  }

  function renderPreview() {
    const map = currentMap();
    const built = XLSX_IO.buildExpenses(parsed, map);
    let html = "<thead><tr><th>항목</th><th>카테고리</th><th>금액</th><th>주기</th></tr></thead><tbody>";
    built.expenses.slice(0, 30).forEach(function (e) {
      html += "<tr><td>" + esc(e.name) + "</td><td>" + esc(e.category) + "</td>" +
        "<td class='num'>" + CALC.fmtWon(e.amount) + "</td><td>" + (e.cycle === "yearly" ? "연 1회" : "매달") + "</td></tr>";
    });
    if (built.salaryCount > 0) {
      html += "<tr class='subtotal'><td>인건비 " + built.salaryCount + "행 → 합계 1줄로 합산</td><td>인건비</td>" +
        "<td class='num'>" + CALC.fmtWon(built.salarySum) + "</td><td>매달</td></tr>";
    }
    html += "</tbody>";
    document.getElementById("prevTable").innerHTML = html;
  }

  function commit() {
    const map = currentMap();
    if (map.name < 0 || map.amount < 0) { MAIN.toast("항목 이름과 금액 열은 꼭 지정해 주세요"); return; }
    const built = XLSX_IO.buildExpenses(parsed, map);
    let msg = built.expenses.length + "개 지출을 추가합니다.";
    if (built.salaryCount > 0) msg += "\n인건비 " + built.salaryCount + "행은 합계 1줄(" + CALC.fmtWon(built.salarySum) + ")로 합산됩니다.";
    if (document.getElementById("impReplace").checked) msg += "\n기존 지출은 모두 교체됩니다.";
    if (!confirm(msg + "\n\n진행할까요?")) return;

    let chain = Promise.resolve();
    if (document.getElementById("impReplace").checked) {
      S.expenses.forEach(function (e) {
        if (e.id === STORE.SALARY_ID) return;
        chain = chain.then(function () { return STORE.deleteExpense(e.id); });
      });
    }
    built.expenses.forEach(function (e) {
      chain = chain.then(function () { return STORE.saveExpense(e); });
    });
    if (built.salaryCount > 0) {
      chain = chain.then(function () {
        const cur = S.expenses.find(function (e) { return e.id === STORE.SALARY_ID; }) || STORE.defaultSalary();
        cur.amount = built.salarySum;
        return STORE.saveExpense(cur);
      });
    }
    chain.then(function () {
      MAIN.toast("가져오기를 완료했어요");
      parsed = null;
      document.getElementById("importArea").innerHTML = "";
      MAIN.goTab("expenses");
    }).catch(function (e) { MAIN.toast("가져오기 실패: " + e.message); });
  }

  window.UI_EXCEL = { render: render, init: init };
})();
