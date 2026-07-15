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
      // costModel은 기본값 위에 저장값을 깊게 병합 (예전 데이터에 새 필드가 없어도 동작)
      const def = CALC.defaultCostModel();
      const saved = S.settings.costModel || {};
      S.settings.costModel = Object.assign({}, def, saved, {
        tokensPerProblemCall: Object.assign({}, def.tokensPerProblemCall, saved.tokensPerProblemCall || {}),
        prices: Object.assign({}, def.prices, saved.prices || {}),
        segments: (saved.segments && saved.segments.length) ? saved.segments : def.segments
      });
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

  function defaultScenario(order) {
    return {
      id: newId("scn"),
      name: "시나리오 " + (order + 1),
      color: order % 5, order: order,
      startMonth: nowYm(), months: 24,
      streams: [{ id: newId("st"), name: "구독 수익", price: 9900, users: 100, conv: 0.3, growth: 0.05, startOffset: 0 }],
      notes: ""
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
    defaultScenario: defaultScenario, defaultSalary: defaultSalary
  };
})();
