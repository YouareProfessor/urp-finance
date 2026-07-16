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
  // stream: {name, type("sub"|"ads"), price(인당 가격), currency("KRW"|"USD"), users(사용자 수),
  //   conv(전환율 0~1, sub 전용), growth(월 성장률 0~1), startOffset(개월), pppMultiplier(지역 가격 배수),
  //   impressionsPerUser(월 광고 노출수, ads 전용), ecpm(1000회당 광고단가, ads 전용)}
  // type 미지정(기존 데이터)은 "sub"로 취급 — 하위호환.
  function streamHeadcount(stream, m) {
    const off = stream.startOffset || 0;
    if (m < off) return 0;
    const growth = Math.pow(1 + (stream.growth || 0), m - off);
    return (stream.users || 0) * growth;
  }
  function streamPayingUsers(stream, m) {
    if (stream.type === "ads") return 0; // 광고형은 결제자가 아니라 노출 대상
    return streamHeadcount(stream, m) * (stream.conv == null ? 1 : stream.conv);
  }
  // API 비용 계산에 들어갈 "실제 앱을 쓰는 인원" — 구독형은 결제 전환된 인원, 광고형은 전체 인원(전원 사용)
  function streamActiveUsers(stream, m) {
    return stream.type === "ads" ? streamHeadcount(stream, m) : streamPayingUsers(stream, m);
  }
  function streamRevenue(stream, m, fxRate) {
    const fx = stream.currency === "USD" ? (fxRate || 1400) : 1;
    const ppp = stream.pppMultiplier || 1;
    if (stream.type === "ads") {
      const impressions = streamHeadcount(stream, m) * (stream.impressionsPerUser || 0);
      return (stream.ecpm || 0) * fx * ppp * impressions / 1000;
    }
    return (stream.price || 0) * fx * ppp * streamPayingUsers(stream, m);
  }

  // 지역 가격(PPP) 프리셋 — 구매력 기준 추정 배수. 정밀한 시장조사 전까지의 출발점이며 언제든 직접 조정 가능.
  const REGION_PRESETS = [
    { code: "KR", label: "🇰🇷 한국", mult: 1.0 },
    { code: "US", label: "🇺🇸 미국", mult: 1.3 },
    { code: "JP", label: "🇯🇵 일본", mult: 1.1 },
    { code: "SEA", label: "🇻🇳 동남아", mult: 0.4 },
    { code: "IN", label: "🇮🇳 인도", mult: 0.3 }
  ];

  // scenario: {startMonth:"2026-08", months, streams:[...]}  — settings.fxRate로 달러 수익원 환산
  function scenarioSeries(sc, settings) {
    const out = [];
    const n = sc.months || 24;
    const fx = (settings && settings.fxRate) || 1400;
    for (let m = 0; m < n; m++) {
      let rev = 0, payingUsers = 0, activeUsers = 0;
      (sc.streams || []).forEach(function (st) {
        rev += streamRevenue(st, m, fx);
        payingUsers += streamPayingUsers(st, m);
        activeUsers += streamActiveUsers(st, m);
      });
      out.push({
        ym: ymAdd(sc.startMonth, m), revenue: Math.round(rev),
        payingUsers: Math.round(payingUsers), activeUsers: Math.round(activeUsers)
      });
    }
    return out;
  }

  // ---- API 변동원가 모델 ----
  // 기본값은 니가교수_API원가_측정템플릿.xlsx 실측(2026-07-14 기하 진단 1건: 문제당 27.09원, 후속 1회 → 54.18원)
  function defaultCostModel() {
    return {
      problemsPerHour: 8,          // 시간당 푸는 문제 수
      followUpCalls: 1,            // 문제당 후속 호출(재질문·힌트)
      tokensPerProblemCall: { fresh: 1400, cacheRead: 3000, cacheWrite: 0, out: 950 },
      prices: { fresh: 3, cacheRead: 0.3, cacheWrite: 3.75, out: 15 }, // Sonnet, USD/100만 토큰 (보수적)
      savingPct: 0,                // 토큰 절감률 % (기술 발전으로 조절)
      feeRate: 0.033,              // 결제 수수료율 (PG 3.3%, 스토어 결제면 +15%p)
      freeUsers: 500,              // PK/MK 등 무료 제공 사용자(매출 0, API 비용은 발생) — 베타 추정치
      segments: [
        { name: "열정 학생", pct: 20, hoursPerDay: 3, daysPerWeek: 6 },
        { name: "일반 학생", pct: 50, hoursPerDay: 1, daysPerWeek: 5 },
        { name: "유령 구독자", pct: 30, hoursPerDay: 0, daysPerWeek: 0 }
      ]
    };
  }

  // 업계 표준 사용자 구성 벤치마크 — 교육 앱 DAU/MAU 15~25%(출처: UXCam, MetricHQ)를
  // 현재 3분류(열정/일반/유령)로 환산한 값. logic.html §4~5 세그먼트 추천안 근거와 동일.
  const INDUSTRY_BENCHMARK = {
    bySegmentName: { "열정 학생": 10, "일반 학생": 60, "유령 구독자": 30 },
    source: "교육 앱 DAU/MAU 15~25% (UXCam·MetricHQ) 기준 · logic.html §4~5 세그먼트 추천안 3분류 환산"
  };

  const WEEKS_PER_MONTH = 4.345;

  // 인당 월 원가: 세그먼트별 + 가중평균(블렌디드) + 시간당 토큰(현재 기술/절감 후)
  function costPerUser(cm, fxRate) {
    const fx = fxRate || 1400;
    const eff = Math.max(0, 1 - (cm.savingPct || 0) / 100);
    const t = cm.tokensPerProblemCall, p = cm.prices;
    const calls = 1 + (cm.followUpCalls || 0);
    const usdPerCall = ((t.fresh || 0) * p.fresh + (t.cacheRead || 0) * p.cacheRead +
      (t.cacheWrite || 0) * p.cacheWrite + (t.out || 0) * p.out) / 1e6;
    const costPerProblemKRW = usdPerCall * calls * eff * fx;
    const tokensPerProblem = ((t.fresh || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0) + (t.out || 0)) * calls;
    const tokensPerHour = tokensPerProblem * (cm.problemsPerHour || 0);
    const sumPct = cm.segments.reduce(function (a, s) { return a + (s.pct || 0); }, 0) || 1;
    const perSeg = cm.segments.map(function (s) {
      const problemsMonth = (s.hoursPerDay || 0) * (s.daysPerWeek || 0) * WEEKS_PER_MONTH * (cm.problemsPerHour || 0);
      return {
        name: s.name, pct: s.pct || 0,
        hoursMonth: (s.hoursPerDay || 0) * (s.daysPerWeek || 0) * WEEKS_PER_MONTH,
        problemsMonth: Math.round(problemsMonth),
        costMonth: Math.round(problemsMonth * costPerProblemKRW)
      };
    });
    const blended = perSeg.reduce(function (a, s) { return a + s.costMonth * s.pct; }, 0) / sumPct;
    return {
      perSeg: perSeg, blended: Math.round(blended),
      costPerProblemKRW: costPerProblemKRW, tokensPerProblem: tokensPerProblem,
      tokensPerHour: tokensPerHour, tokensPerHourSaved: Math.round(tokensPerHour * eff),
      sumPct: sumPct
    };
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
    const series = scenarioSeries(sc, settings);
    let cum = 0;
    const cashBase = (settings && settings.cashBalance) || 0;
    const cashAsOf = (settings && settings.cashAsOf) || sc.startMonth;
    const cm = (settings && settings.costModel) || defaultCostModel();
    const cu = costPerUser(cm, settings && settings.fxRate);
    series.forEach(function (pt) {
      const act = actuals && actuals[pt.ym];
      const revenue = act && act.revenue != null ? act.revenue : pt.revenue;
      const fixed = monthlyFixedCost(expenses, pt.ym);
      // 변동비: (앱을 실제로 쓰는 전체 인원: 구독 결제자 + 광고형 무료 + PK/MK 무료) × 인당 API원가 + 결제 수수료
      // — 광고형·PK/MK는 매출 방식이 다르거나 없지만 API는 쓰므로 비용에는 다 더한다 (실적 월은 costOverride가 전체 비용을 대체)
      const api = Math.round((pt.activeUsers + (cm.freeUsers || 0)) * cu.blended);
      const fee = Math.round(revenue * (cm.feeRate || 0));
      const cost = act && act.costOverride != null ? act.costOverride : fixed + api + fee;
      const profit = revenue - cost;
      cum += profit;
      rows.push({
        ym: pt.ym, revenue: revenue, cost: cost, profit: profit, cum: cum,
        fixed: fixed, api: api, fee: fee, payingUsers: pt.payingUsers, activeUsers: pt.activeUsers,
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
    streamRevenue: streamRevenue, streamPayingUsers: streamPayingUsers, streamActiveUsers: streamActiveUsers,
    streamHeadcount: streamHeadcount, scenarioSeries: scenarioSeries, REGION_PRESETS: REGION_PRESETS,
    defaultCostModel: defaultCostModel, costPerUser: costPerUser, INDUSTRY_BENCHMARK: INDUSTRY_BENCHMARK,
    expenseMonthly: expenseMonthly, monthlyFixedCost: monthlyFixedCost,
    pnlSeries: pnlSeries, breakEven: breakEven, runwayInfo: runwayInfo,
    fmtWon: fmtWon, fmtWonShort: fmtWonShort, fmtMonths: fmtMonths
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CALC = api;
})(typeof window !== "undefined" ? window : globalThis);
