/* xlsx.js — SheetJS 지연 로드 + 3시트 내보내기 + 가져오기 파싱.
   인건비로 분류된 행은 항상 salary_total 한 줄로 합산한다(개인별 비공개 원칙). */
(function () {
  "use strict";
  const S = STORE.S;
  const CDN = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
  let loading = null;

  function ensureLib() {
    if (window.XLSX) return Promise.resolve();
    if (!loading) {
      loading = new Promise(function (res, rej) {
        const s = document.createElement("script");
        s.src = CDN;
        s.onload = res;
        s.onerror = function () { loading = null; rej(new Error("엑셀 라이브러리를 불러오지 못했어요. 인터넷을 확인해 주세요.")); };
        document.head.appendChild(s);
      });
    }
    return loading;
  }

  // ---- 내보내기 ----
  function exportWorkbook() {
    return ensureLib().then(function () {
      const wb = XLSX.utils.book_new();
      const sc = STORE.activeScenario();

      // ① 월별손익
      if (sc) {
        const horizon = S.settings.horizonMonths || 24;
        const scH = Object.assign({}, sc, { months: Math.min(horizon, sc.months || 24) });
        const rows = CALC.pnlSeries(scH, S.expenses, S.actuals, S.settings);
        const aoa = [["월", "매출", "고정지출", "순손익", "누적손익", "현금잔고", "구분"]];
        rows.forEach(function (r) {
          aoa.push([r.ym, r.revenue, r.cost, r.profit, r.cum, r.cash != null ? r.cash : "", r.isActual ? "실적" : "추정"]);
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "월별손익");
      }

      // ② 고정지출 (가져오기와 왕복 호환)
      const ym = STORE.nowYm();
      const aoa2 = [["항목", "카테고리", "월 환산 금액", "주기", "시작월", "종료월", "메모"]];
      let total = 0;
      S.expenses.forEach(function (e) {
        const m = Math.round(CALC.expenseMonthly(e));
        total += CALC.monthlyFixedCost([e], ym);
        aoa2.push([e.name, e.category || "기타", m, e.cycle === "yearly" ? "연 1회" : "매달", e.startMonth || "", e.endMonth || "", e.memo || ""]);
      });
      aoa2.push(["합계", "", Math.round(total), "", "", "", "이번 달 기준"]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa2), "고정지출");

      // ③ 시나리오 (파라미터 블록 + 월 매출 매트릭스)
      const aoa3 = [];
      S.scenarios.forEach(function (s) {
        aoa3.push(["시나리오", s.name, "시작", s.startMonth, "기간(개월)", s.months]);
        aoa3.push(["수익원", "인당 가격", "사용자 수", "전환율", "월 성장률", "시작 시점(개월 뒤)"]);
        (s.streams || []).forEach(function (st) {
          aoa3.push([st.name, st.price, st.users, st.conv, st.growth, st.startOffset || 0]);
        });
        const series = CALC.scenarioSeries(s);
        aoa3.push(["월"].concat(series.map(function (p) { return p.ym; })));
        aoa3.push(["매출"].concat(series.map(function (p) { return p.revenue; })));
        aoa3.push([]);
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa3.length ? aoa3 : [["시나리오 없음"]]), "시나리오");

      const today = new Date();
      const name = "URP-재무보드-" + today.getFullYear() + "-" +
        String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0") + ".xlsx";
      XLSX.writeFile(wb, name);
      return name;
    });
  }

  // ---- 가져오기 파싱 ----
  const HEADER_ALIASES = {
    name: ["항목", "이름", "내역", "품목", "항목명", "name", "item"],
    amount: ["금액", "비용", "월비용", "월 환산 금액", "월환산", "가격", "amount", "cost", "price"],
    category: ["카테고리", "분류", "구분", "category", "type"],
    cycle: ["주기", "cycle"],
    memo: ["메모", "비고", "설명", "memo", "note"]
  };

  function guessCol(headers, key) {
    const al = HEADER_ALIASES[key];
    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i] || "").trim().toLowerCase();
      if (al.some(function (a) { return h === a.toLowerCase() || h.indexOf(a.toLowerCase()) >= 0; })) return i;
    }
    return -1;
  }

  // file → {headers, rows(aoa), guess:{name,amount,category,cycle,memo}}
  function parseFile(file) {
    return ensureLib().then(function () {
      return file.arrayBuffer();
    }).then(function (buf) {
      const wb = XLSX.read(buf, { type: "array" });
      // "고정지출" 시트 우선, 없으면 첫 시트
      const sheetName = wb.SheetNames.indexOf("고정지출") >= 0 ? "고정지출" : wb.SheetNames[0];
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
      // 빈 행 제거
      const rows = aoa.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ""; }); });
      if (rows.length < 2) throw new Error("데이터가 없는 파일이에요.");
      const headers = rows[0].map(function (h) { return String(h); });
      return {
        sheetName: sheetName,
        headers: headers,
        rows: rows.slice(1),
        guess: {
          name: guessCol(headers, "name"),
          amount: guessCol(headers, "amount"),
          category: guessCol(headers, "category"),
          cycle: guessCol(headers, "cycle"),
          memo: guessCol(headers, "memo")
        }
      };
    });
  }

  // 매핑 적용 → {expenses:[...], salarySum, salaryCount, skipped}
  function buildExpenses(parsed, map) {
    const out = [];
    let salarySum = 0, salaryCount = 0, skipped = 0;
    parsed.rows.forEach(function (r, i) {
      const name = String(r[map.name] || "").trim();
      const amount = Number(String(r[map.amount] || "").replace(/[^0-9.-]/g, "")) || 0;
      if (!name || amount <= 0) { skipped++; return; }
      if (name === "합계" || name === "총계" || name.toLowerCase() === "total") { skipped++; return; }
      let category = map.category >= 0 ? String(r[map.category] || "").trim() : "기타";
      if (STORE.CATEGORIES.indexOf(category) < 0) {
        // 인건비 유사어 감지
        if (/급여|월급|인건|연봉|salary|payroll/i.test(category + " " + name)) category = "인건비";
        else category = "기타";
      }
      const cycleRaw = map.cycle >= 0 ? String(r[map.cycle] || "") : "";
      const cycle = /연|year/i.test(cycleRaw) ? "yearly" : "monthly";
      const memo = map.memo >= 0 ? String(r[map.memo] || "").trim() : "";
      if (category === "인건비") {
        // 개인별 급여는 절대 항목화하지 않음 — 합계로만
        salarySum += cycle === "yearly" ? amount / 12 : amount;
        salaryCount++;
        return;
      }
      out.push({
        id: STORE.newId("exp"), name: name, category: category, amount: amount,
        cycle: cycle, memo: memo, startMonth: null, endMonth: null, order: 1000 + i
      });
    });
    return { expenses: out, salarySum: Math.round(salarySum), salaryCount: salaryCount, skipped: skipped };
  }

  window.XLSX_IO = { exportWorkbook: exportWorkbook, parseFile: parseFile, buildExpenses: buildExpenses };
})();
