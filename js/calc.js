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
  // stream: {name, type("sub"|"pass"|"ads"), price(인당 가격), currency("KRW"|"USD"), users(사용자 수),
  //   conv(전환율 0~1, sub·pass 전용), growth(월 성장률 0~1), startOffset(개월), pppMultiplier(지역 가격 배수),
  //   buysPerYear(연간 구매 횟수, pass 전용), daysPerPass(패스 1장 유효일수, pass 전용),
  //   impressionsPerUser(월 광고 노출수, ads 전용), ecpm(1000회당 광고단가, ads 전용)}
  // type 미지정(기존 데이터)은 "sub"로 취급 — 하위호환.
  //
  // pass(기간권) = 대학생 시험기간 패스처럼 "매달 빠져나가는 구독"이 아니라 1년에 몇 번 사는 단발 결제.
  // 구독으로 뭉뚱그리면 매출이 12배 부풀려지므로 별도 유형으로 둔다. 월 환산 규칙:
  //   월 결제자   = 모집단 × 구매전환율 × 연간구매횟수 ÷ 12
  //   월 사용인원 = 모집단 × 구매전환율 × 연간구매횟수 × 패스일수 ÷ 365   (평균 동시 사용자)
  // 시험 시즌에 몰리는 계절성은 연 평균으로 편다 — 손익분기·런웨이 판단에는 평균이 맞고,
  // 실제 스파이크는 손익표의 월별 실적 입력으로 잡는다.
  const DAYS_PER_YEAR = 365;
  function streamHeadcount(stream, m) {
    const off = stream.startOffset || 0;
    if (m < off) return 0;
    const growth = Math.pow(1 + (stream.growth || 0), m - off);
    return (stream.users || 0) * growth;
  }
  function streamPayingUsers(stream, m) {
    if (stream.type === "ads") return 0; // 광고형은 결제자가 아니라 노출 대상
    const conv = stream.conv == null ? 1 : stream.conv;
    if (stream.type === "pass") {
      return streamHeadcount(stream, m) * conv * (stream.buysPerYear || 0) / 12;
    }
    return streamHeadcount(stream, m) * conv;
  }
  // API 비용 계산에 들어갈 "실제 앱을 쓰는 인원" — 구독형은 결제 전환된 인원, 광고형은 전체 인원(전원 사용),
  // 기간권은 패스가 살아있는 동안만 쓰므로 평균 동시 사용자로 환산한다.
  function streamActiveUsers(stream, m) {
    if (stream.type === "ads") return streamHeadcount(stream, m);
    if (stream.type === "pass") {
      const conv = stream.conv == null ? 1 : stream.conv;
      return streamHeadcount(stream, m) * conv * (stream.buysPerYear || 0) *
        (stream.daysPerPass || 0) / DAYS_PER_YEAR;
    }
    return streamPayingUsers(stream, m);
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

  // ---- API 변동원가 모델 (기능별) ----
  // 니가교수 앱은 1:1 개념과외·문제풀이(복습카드)·시험 세 기능이 AI 호출 패턴이 서로 완전히 달라서
  // (턴 수·캐시 재사용·이미지 첨부 여부) "문제당 원가 하나"로 뭉뚱그리면 실제와 크게 어긋난다.
  // 아래 wonPerUnit 기본값은 앱 코드(Tutor.jsx/Study.jsx/Exam.jsx)의 실제 시스템 프롬프트를 토큰화하고
  // 턴 단위로 시뮬레이션해 나온 값이다(2026-07-16) — 실측이 아니라 코드 구조 기반 시뮬레이션.
  // Worker+D1 실측 로깅(계획서 Phase 1)이 붙으면 이 값을 실측치로 교체한다.
  function defaultCostModel() {
    return {
      savingPct: 0,                // 토큰 절감률 % (캐시 활용·모델 라우팅 등 기술 개선으로 조절 — 전 기능에 균일 적용)
      feeRate: 0.033,              // 결제 수수료율 (PG 3.3%, 스토어 결제면 +15%p)
      freeUsers: 500,              // PK/MK 등 무료 제공 사용자(매출 0, API 비용은 발생) — 베타 추정치
      features: {
        tutor: { name: "1:1 개념과외", unitLabel: "개념 1개(6턴)", wonPerUnit: 138 },
        study: { name: "문제풀이(복습카드)", unitLabel: "카드 1개", wonPerUnit: 30 },
        exam: { name: "시험", unitLabel: "8문항 1회", wonPerUnit: 206 }
      },
      segments: [
        { name: "열정 학생", pct: 20, tutorPerMonth: 12, studyPerMonth: 400, examPerMonth: 4 },
        { name: "일반 학생", pct: 50, tutorPerMonth: 4, studyPerMonth: 100, examPerMonth: 1 },
        { name: "유령 구독자", pct: 30, tutorPerMonth: 0, studyPerMonth: 0, examPerMonth: 0 }
      ]
    };
  }

  const WEEKS_PER_MONTH = 4.345;

  // 구형(시간 기반: hoursPerDay/daysPerWeek + tokensPerProblemCall/prices/followUpCalls/problemsPerHour) 저장값을
  // 새 기능별 구조로 이관한다. 팀이 라이브에서 이미 조정해둔 값(예: 후속호출 5회, 세그먼트 10/60/30%)이 있으면
  // 그 계산 결과를 'study'(문제풀이) 단가·사용량으로 그대로 흡수해서, 배포해도 인당 월원가가 갑자기 안 바뀌게 한다.
  // 개념과외·시험은 신규 카테고리라 사용량 0으로만 추가(팀이 원할 때 직접 켬).
  function migrateCostModel(saved, fxRate) {
    const def = defaultCostModel();
    if (!saved || !Array.isArray(saved.segments) || !saved.segments.length) return def;
    const isLegacy = saved.segments.some(function (s) { return s.tutorPerMonth == null && s.hoursPerDay != null; });
    if (!isLegacy) {
      // 이미 신규 구조 — features만 기본값과 안전 병합(예전 버전에 없던 기능 필드 보완)
      return Object.assign({}, def, saved, {
        features: {
          tutor: Object.assign({}, def.features.tutor, saved.features && saved.features.tutor),
          study: Object.assign({}, def.features.study, saved.features && saved.features.study),
          exam: Object.assign({}, def.features.exam, saved.features && saved.features.exam)
        }
      });
    }
    const fx = fxRate || 1400;
    const t = saved.tokensPerProblemCall || { fresh: 1400, cacheRead: 3000, cacheWrite: 0, out: 950 };
    const p = saved.prices || { fresh: 3, cacheRead: 0.3, cacheWrite: 3.75, out: 15 };
    const calls = 1 + (saved.followUpCalls != null ? saved.followUpCalls : 1);
    const problemsPerHour = saved.problemsPerHour != null ? saved.problemsPerHour : 8;
    const usdPerCall = ((t.fresh || 0) * p.fresh + (t.cacheRead || 0) * p.cacheRead +
      (t.cacheWrite || 0) * p.cacheWrite + (t.out || 0) * p.out) / 1e6;
    const studyWonPerUnit = Math.round(usdPerCall * calls * fx); // 예전 '문제당 비용'을 그대로 복습카드 단가로
    const segments = saved.segments.map(function (s) {
      const problemsMonth = Math.round((s.hoursPerDay || 0) * (s.daysPerWeek || 0) * WEEKS_PER_MONTH * problemsPerHour);
      return { name: s.name, pct: s.pct || 0, tutorPerMonth: 0, studyPerMonth: problemsMonth, examPerMonth: 0 };
    });
    return Object.assign({}, def, {
      savingPct: saved.savingPct || 0,
      feeRate: saved.feeRate != null ? saved.feeRate : def.feeRate,
      freeUsers: saved.freeUsers != null ? saved.freeUsers : def.freeUsers,
      features: {
        tutor: def.features.tutor,
        study: Object.assign({}, def.features.study, { wonPerUnit: studyWonPerUnit }),
        exam: def.features.exam
      },
      segments: segments
    });
  }

  // 업계 표준 사용자 구성 벤치마크 — 교육 앱 DAU/MAU 15~25%(출처: UXCam, MetricHQ)를
  // 현재 3분류(열정/일반/유령)로 환산한 값. logic.html §4~5 세그먼트 추천안 근거와 동일.
  const INDUSTRY_BENCHMARK = {
    bySegmentName: { "열정 학생": 10, "일반 학생": 60, "유령 구독자": 30 },
    source: "교육 앱 DAU/MAU 15~25% (UXCam·MetricHQ) 기준 · logic.html §4~5 세그먼트 추천안 3분류 환산"
  };

  const FEATURE_KEYS = ["tutor", "study", "exam"];

  // 인당 월 원가: 세그먼트별(기능별 사용량 × 기능별 단가 합) + 가중평균(블렌디드)
  function costPerUser(cm, fxRate) {
    const eff = Math.max(0, 1 - (cm.savingPct || 0) / 100);
    const feat = cm.features || {};
    const wonPerUnit = function (key) { return ((feat[key] && feat[key].wonPerUnit) || 0) * eff; };
    const sumPct = cm.segments.reduce(function (a, s) { return a + (s.pct || 0); }, 0) || 1;
    const perSeg = cm.segments.map(function (s) {
      const breakdown = {};
      let costMonth = 0;
      FEATURE_KEYS.forEach(function (k) {
        const units = s[k + "PerMonth"] || 0;
        const cost = Math.round(units * wonPerUnit(k));
        breakdown[k] = cost;
        costMonth += cost;
      });
      return {
        name: s.name, pct: s.pct || 0,
        tutorPerMonth: s.tutorPerMonth || 0, studyPerMonth: s.studyPerMonth || 0, examPerMonth: s.examPerMonth || 0,
        breakdown: breakdown, costMonth: Math.round(costMonth)
      };
    });
    const blended = perSeg.reduce(function (a, s) { return a + s.costMonth * s.pct; }, 0) / sumPct;
    return {
      perSeg: perSeg, blended: Math.round(blended),
      sumPct: sumPct, savingEff: eff, features: feat
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
      // — 광고형·PK/MK는 매출 방식이 다르거나 없지만 API는 쓰므로 비용에는 다 더한다
      // apiOverride: API원가만 실측값으로 부분 대체(Worker+D1 로깅 실측 반영용). costOverride가 있으면 그게 전체를 대체하므로 우선.
      const api = act && act.apiOverride != null ? act.apiOverride
        : Math.round((pt.activeUsers + (cm.freeUsers || 0)) * cu.blended);
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
    defaultCostModel: defaultCostModel, migrateCostModel: migrateCostModel, costPerUser: costPerUser, INDUSTRY_BENCHMARK: INDUSTRY_BENCHMARK,
    expenseMonthly: expenseMonthly, monthlyFixedCost: monthlyFixedCost,
    pnlSeries: pnlSeries, breakEven: breakEven, runwayInfo: runwayInfo,
    fmtWon: fmtWon, fmtWonShort: fmtWonShort, fmtMonths: fmtMonths
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CALC = api;
})(typeof window !== "undefined" ? window : globalThis);
