/* calc.js — 순수 계산 함수. DOM/Firebase 무접촉, node로 바로 검증 가능.
   스팟체크 예시:
     streamRevenue({price:9900, users:200, conv:0.3, growth:0, startOffset:0}, 0) === 594000
     runway: 현금 10,000,000 / 월 순유출 2,000,000 = 5.0개월 */
(function (root) {
  "use strict";

  // ---- 월 키 유틸 ----
  function ymAdd(ym, n) {
    const [y, m] = ym.split("-").map(Number);
    const t = y * 12 + (m - 1) + n;
    return String(Math.floor(t / 12)) + "-" + String((t % 12) + 1).padStart(2, "0");
  }
  function ymDiff(a, b) { // a - b (개월)
    const [ay, am] = a.split("-").map(Number);
    const [by, bm] = b.split("-").map(Number);
    return (ay * 12 + am) - (by * 12 + bm);
  }
  function ymLabel(ym) {
    const [y, m] = ym.split("-");
    return String(Number(y)).slice(2) + "년 " + Number(m) + "월";
  }

  // ---- 수익 스트림 ----
  // stream: {name, price(인당 가격), users(사용자 수), conv(전환율 0~1), growth(월 성장률 0~1), startOffset(개월)}
  function streamRevenue(stream, m) {
    const off = stream.startOffset || 0;
    if (m < off) return 0;
    const growth = Math.pow(1 + (stream.growth || 0), m - off);
    return (stream.price || 0) * (stream.users || 0) * growth * (stream.conv == null ? 1 : stream.conv);
  }

  // scenario: {startMonth:"2026-08", months, streams:[...]}
  function scenarioSeries(sc) {
    const out = [];
    const n = sc.months || 24;
    for (let m = 0; m < n; m++) {
      let rev = 0;
      (sc.streams || []).forEach(function (st) { rev += streamRevenue(st, m); });
      out.push({ ym: ymAdd(sc.startMonth, m), revenue: Math.round(rev) });
    }
    return out;
  }

  // ---- 고정지출 ----
  function expenseMonthly(exp) {
    const amt = exp.amount || 0;
    return exp.cycle === "yearly" ? amt / 12 : amt;
  }
  function expenseActive(exp, ym) {
    if (exp.startMonth && ymDiff(ym, exp.startMonth) < 0) return false;
    if (exp.endMonth && ymDiff(ym, exp.endMonth) > 0) return false;
    return true;
  }
  function monthlyFixedCost(expenses, ym) {
    let sum = 0;
    (expenses || []).forEach(function (e) { if (expenseActive(e, ym)) sum += expenseMonthly(e); });
    return Math.round(sum);
  }

  // ---- 손익 시리즈 ----
  // actuals: { "YYYY-MM": {revenue, costOverride} }
  // settings: {cashBalance, cashAsOf}
  function pnlSeries(sc, expenses, actuals, settings) {
    const rows = [];
    const series = scenarioSeries(sc);
    let cum = 0;
    const cashBase = (settings && settings.cashBalance) || 0;
    const cashAsOf = (settings && settings.cashAsOf) || sc.startMonth;
    series.forEach(function (pt) {
      const act = actuals && actuals[pt.ym];
      const revenue = act && act.revenue != null ? act.revenue : pt.revenue;
      const cost = act && act.costOverride != null ? act.costOverride : monthlyFixedCost(expenses, pt.ym);
      const profit = revenue - cost;
      cum += profit;
      rows.push({
        ym: pt.ym, revenue: revenue, cost: cost, profit: profit, cum: cum,
        isActual: !!act,
        // 현금곡선: 기준월 이전 구간은 표시하지 않음(null)
        cash: ymDiff(pt.ym, cashAsOf) >= 0 ? null : null // 아래에서 채움
      });
    });
    // 현금곡선: cashAsOf부터 누적손익 반영 (기준월의 시작 잔고 = cashBalance)
    let cash = cashBase;
    rows.forEach(function (r) {
      if (ymDiff(r.ym, cashAsOf) >= 0) { cash += r.profit; r.cash = Math.round(cash); }
    });
    return rows;
  }

  // ---- 손익분기 ----
  // 헤드라인 = 월 흑자 전환(monthlyBE), 보조 = 누적 흑자(cumulativeBE)
  function breakEven(rows) {
    let monthlyBE = null, cumulativeBE = null;
    for (let i = 0; i < rows.length; i++) {
      if (monthlyBE == null && rows[i].profit >= 0) monthlyBE = rows[i].ym;
      if (cumulativeBE == null && rows[i].cum >= 0) cumulativeBE = rows[i].ym;
      if (monthlyBE && cumulativeBE) break;
    }
    return { monthlyBE: monthlyBE, cumulativeBE: cumulativeBE };
  }

  // ---- 런웨이 ----
  // 이번 달(첫 행 또는 지정 ym)의 순유출 기준. 흑자면 Infinity.
  function runwayInfo(rows, settings, nowYm) {
    const cashBase = (settings && settings.cashBalance) || 0;
    let row = rows[0];
    if (nowYm) { const f = rows.find(function (r) { return r.ym === nowYm; }); if (f) row = f; }
    if (!row) return { months: null, burn: 0, cashOutYm: null };
    const burn = row.cost - row.revenue; // 양수 = 순유출
    let months = burn <= 0 ? Infinity : cashBase / burn;
    // 시나리오 조건부: 현금곡선이 처음 0 아래로 내려가는 달
    let cashOutYm = null;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].cash != null && rows[i].cash < 0) { cashOutYm = rows[i].ym; break; }
    }
    return { months: months, burn: burn, cashOutYm: cashOutYm };
  }

  // ---- 원화 포맷 ----
  function fmtWon(n) {
    if (n == null || isNaN(n)) return "-";
    return "₩" + Math.round(n).toLocaleString("ko-KR");
  }
  function fmtWonShort(n) {
    if (n == null || isNaN(n)) return "-";
    const sign = n < 0 ? "-" : "";
    const a = Math.abs(Math.round(n));
    if (a >= 100000000) {
      const eok = a / 100000000;
      return sign + (eok >= 10 ? Math.round(eok) : Math.round(eok * 10) / 10) + "억";
    }
    if (a >= 10000) return sign + Math.round(a / 10000).toLocaleString("ko-KR") + "만";
    return sign + a.toLocaleString("ko-KR") + "원";
  }
  function fmtMonths(m) {
    if (m == null) return "-";
    if (m === Infinity) return "∞";
    return (Math.round(m * 10) / 10) + "개월";
  }

  const api = {
    ymAdd: ymAdd, ymDiff: ymDiff, ymLabel: ymLabel,
    streamRevenue: streamRevenue, scenarioSeries: scenarioSeries,
    expenseMonthly: expenseMonthly, monthlyFixedCost: monthlyFixedCost,
    pnlSeries: pnlSeries, breakEven: breakEven, runwayInfo: runwayInfo,
    fmtWon: fmtWon, fmtWonShort: fmtWonShort, fmtMonths: fmtMonths
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CALC = api;
})(typeof window !== "undefined" ? window : globalThis);
