/* store.js — 앱 상태 + Firestore 실시간 구독 + 디바운스 저장.
   모든 화면은 S를 읽고, 변경은 여기의 save* 함수로만 쓴다. */
(function () {
  "use strict";

  const LS_WHO = "urpfin_who";

  const S = {
    roomId: null,
    refs: null,
    who: localStorage.getItem(LS_WHO) || "",
    settings: { cashBalance: 0, cashAsOf: nowYm(), horizonMonths: 24, activeScenarioId: null, fxRate: 1400, costModel: CALC.defaultCostModel() },
    scenarios: [],
    expenses: [],
    actuals: {},
    compareIds: [],   // 비교 모드 선택 (로컬 상태)
    compareOn: false
  };

  // 테마(대분류) — 대표 회계 파일(URP.co회계 파일.xlsx 비용분류표)과 동일한 우리말 분류
  const CATEGORIES = ["인건비", "개발/인프라비", "콘텐츠제작비", "행사운영비", "식비/팀운영비", "교통비", "비품비", "마케팅", "기타"];
  // K-IFRS 계정과목 — 다트(DART) 공시 판매비와관리비에서 흔한 항목
  const ACCOUNTS = [
    "급여", "퇴직급여", "복리후생비", "여비교통비", "기업업무추진비(접대비)",
    "통신비", "수도광열비", "세금과공과", "감가상각비", "무형자산상각비",
    "지급임차료", "보험료", "차량유지비", "운반비", "교육훈련비",
    "도서인쇄비", "소모품비", "지급수수료", "광고선전비", "경상연구개발비",
    "외주용역비", "행사비", "기타판매비와관리비"
  ];
  // 테마 → 기본 계정과목 추천
  const THEME_TO_ACCOUNT = {
    "인건비": "급여", "개발/인프라비": "지급수수료", "콘텐츠제작비": "외주용역비",
    "행사운영비": "행사비", "식비/팀운영비": "복리후생비", "교통비": "여비교통비",
    "비품비": "소모품비", "마케팅": "광고선전비", "기타": "기타판매비와관리비"
  };
  const TEAM = ["수민", "지민", "은우", "세빈", "준서", "정범"];
  const SALARY_ID = "salary_total";

  function nowYm() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  // ---- 구독 ----
  let unsubs = [];
  function connectRoom(roomId, refs, onChange) {
    S.roomId = roomId; S.refs = refs;
    unsubs.forEach(function (u) { u(); }); unsubs = [];
    FB.setSync("", "동기화 중…");
    let firstErr = function (e) { console.error(e); FB.setSync("err", "연결 오류"); };

    unsubs.push(refs.settings.onSnapshot(function (snap) {
      if (snap.exists && !settingsDirty) Object.assign(S.settings, snap.data());
      // costModel: 구형(시간 기반) 저장값이면 팀이 라이브에서 조정해둔 실제 계산 결과를 보존해서 이관
      // (예전 '문제당 원가'를 그대로 복습카드 단가로 흡수 — 배포해도 인당 월원가가 갑자기 안 바뀜)
      S.settings.costModel = CALC.migrateCostModel(S.settings.costModel, S.settings.fxRate);
      if (!S.settings.fxRate) S.settings.fxRate = 1400;
      FB.setSync("on", "실시간 연결됨");
      onChange("settings");
    }, firstErr));

    unsubs.push(refs.scenarios.onSnapshot(function (qs) {
      // 기존 객체에 병합(정체성 유지) — 편집 중인 화면의 참조가 끊기지 않게.
      // 단, 디바운스 저장 대기 중(로컬이 더 최신)이면 서버 스냅샷으로 덮어쓰지 않는다.
      const prev = S.scenarios;
      S.scenarios = qs.docs.map(function (d) {
        const data = d.data(); data.id = d.id;
        const existing = prev.find(function (s) { return s.id === d.id; });
        if (existing && scnTimers[d.id]) return existing; // 로컬 수정이 저장 대기 중
        return existing ? Object.assign(existing, data) : data;
      }).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      if (!S.settings.activeScenarioId && S.scenarios.length) {
        S.settings.activeScenarioId = S.scenarios[0].id;
      }
      onChange("scenarios");
    }, firstErr));

    unsubs.push(refs.expenses.onSnapshot(function (qs) {
      const prevE = S.expenses;
      S.expenses = qs.docs.map(function (d) {
        const data = d.data(); data.id = d.id;
        const existing = prevE.find(function (e) { return e.id === d.id; });
        return existing ? Object.assign(existing, data) : data;
      }).sort(function (a, b) {
          if (a.id === SALARY_ID) return -1; if (b.id === SALARY_ID) return 1;
          return (a.order || 0) - (b.order || 0);
        });
      onChange("expenses");
    }, firstErr));

    unsubs.push(refs.actuals.onSnapshot(function (qs) {
      const map = {};
      qs.docs.forEach(function (d) { map[d.id] = d.data(); });
      S.actuals = map;
      onChange("actuals");
    }, firstErr));
  }

  // ---- 저장 (updatedBy 스탬프 공통) ----
  function stamp(data) {
    data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    data.updatedBy = S.who || "이름없음";
    return data;
  }
  // 보기 전용이면 모든 저장 차단
  function roGuard() {
    if (!S.readOnly) return false;
    if (window.MAIN) MAIN.toast("보기 전용이라 수정할 수 없어요");
    return true;
  }

  function saveSettings(patch) {
    if (roGuard()) return Promise.resolve();
    Object.assign(S.settings, patch);
    return S.refs.settings.set(stamp(Object.assign({}, patch)), { merge: true });
  }
  // 원가모델 슬라이더용 디바운스 저장
  let settingsTimer = null;
  let settingsDirty = false;
  function saveSettingsDebounced(patch) {
    if (roGuard()) return;
    Object.assign(S.settings, patch);
    settingsDirty = true;
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(function () {
      settingsDirty = false;
      S.refs.settings.set(stamp(Object.assign({}, patch)), { merge: true });
    }, 800);
  }
  function isSettingsDirty() { return settingsDirty; }

  // 시나리오: 슬라이더 드래그가 많으므로 id별 800ms 디바운스
  const scnTimers = {};
  function saveScenarioDebounced(sc) {
    if (roGuard()) return;
    clearTimeout(scnTimers[sc.id]);
    scnTimers[sc.id] = setTimeout(function () {
      delete scnTimers[sc.id]; // 대기 해제 후 저장 (스냅샷 병합 재개)
      saveScenarioNow(sc);
    }, 800);
  }
  function saveScenarioNow(sc) {
    if (roGuard()) return Promise.resolve();
    const data = Object.assign({}, sc); delete data.id;
    return S.refs.scenarios.doc(sc.id).set(stamp(data));
  }
  function deleteScenario(id) {
    if (roGuard()) return Promise.resolve(); return S.refs.scenarios.doc(id).delete(); }

  function saveExpense(exp) {
    if (roGuard()) return Promise.resolve();
    const data = Object.assign({}, exp); const id = data.id; delete data.id;
    return S.refs.expenses.doc(id).set(stamp(data));
  }
  function deleteExpense(id) {
    if (roGuard()) return Promise.resolve();
    if (id === SALARY_ID) return Promise.reject(new Error("인건비 합계는 삭제할 수 없어요."));
    return S.refs.expenses.doc(id).delete();
  }

  function saveActual(ym, data) {
    if (roGuard()) return Promise.resolve();
    if (data == null) return S.refs.actuals.doc(ym).delete();
    return S.refs.actuals.doc(ym).set(stamp(Object.assign({ month: ym }, data)), { merge: true });
  }

  // ---- 헬퍼 ----
  function activeScenario() {
    return S.scenarios.find(function (s) { return s.id === S.settings.activeScenarioId; }) || S.scenarios[0] || null;
  }
  function newId(prefix) {
    return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function setWho(name) { S.who = name; localStorage.setItem(LS_WHO, name); }

  // Provee 확정 요금제 (2026-07-28 대표 확정) — 새 시나리오는 실제 상품 구성으로 시작한다.
  // 고등학생: 결제자가 부모라 매달 나가는 구독. 인강 월 14만·밀당PT 월 38만 아래 가격대.
  // 대학생: 결제자가 본인이라 시험기간에만 산다 → 기간권 4종. 짧을수록 하루당 단가가 비싸다.
  // 사용자 수는 전부 자리표시값이니 슬라이더로 우리 가정에 맞게 바꿔 쓸 것.
  // 대학생 4종은 같은 모집단 1,000명을 공유하며 conv가 "그 시기에 이 상품을 고르는 비율"이다(합 37%).
  function proveeStreams() {
    const pass = function (name, price, days, conv) {
      return {
        id: newId("st"), name: name, type: "pass", price: price,
        users: 1000, conv: conv, buysPerYear: 2, daysPerPass: days,
        growth: 0.05, startOffset: 0, pppMultiplier: 1
      };
    };
    return [
      { id: newId("st"), name: "고등학생 월 구독", type: "sub", price: 99000, users: 1000, conv: 0.3, growth: 0.05, startOffset: 0, pppMultiplier: 1 },
      pass("대학생 중간고사 패스 (3주)", 49000, 21, 0.15),
      pass("대학생 일주일의 전사 (7일)", 29000, 7, 0.10),
      pass("대학생 3일의 전사", 19000, 3, 0.07),
      pass("대학생 24시간의 전사", 9900, 1, 0.05)
    ];
  }

  function defaultScenario(order) {
    return {
      id: newId("scn"),
      name: "시나리오 " + (order + 1),
      color: order % 5, order: order,
      startMonth: nowYm(), months: 24,
      streams: proveeStreams(),
      notes: "Provee 요금제 v1 — 고등 월 99,000원 구독 + 대학생 시험기간 패스 4종. 대학생 4종은 같은 모집단을 공유하니 사용자 수는 같게 두고 전환율만 나눠 조정하세요."
    };
  }
  function defaultSalary() {
    return { id: SALARY_ID, name: "인건비 합계", category: "인건비", account: "급여", isSalaryTotal: true, amount: 0, cycle: "monthly", memo: "개인별 급여는 비공개, 합계만", order: -1 };
  }

  window.STORE = {
    S: S, CATEGORIES: CATEGORIES, ACCOUNTS: ACCOUNTS, THEME_TO_ACCOUNT: THEME_TO_ACCOUNT, TEAM: TEAM, SALARY_ID: SALARY_ID,
    connectRoom: connectRoom, nowYm: nowYm,
    saveSettings: saveSettings, saveSettingsDebounced: saveSettingsDebounced,
    saveScenarioDebounced: saveScenarioDebounced, saveScenarioNow: saveScenarioNow, deleteScenario: deleteScenario,
    saveExpense: saveExpense, deleteExpense: deleteExpense, saveActual: saveActual,
    activeScenario: activeScenario, newId: newId, setWho: setWho,
    defaultScenario: defaultScenario, defaultSalary: defaultSalary, proveeStreams: proveeStreams
  };
})();
