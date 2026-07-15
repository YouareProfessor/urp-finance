/* store.js — 앱 상태 + Firestore 실시간 구독 + 디바운스 저장.
   모든 화면은 S를 읽고, 변경은 여기의 save* 함수로만 쓴다. */
(function () {
  "use strict";

  const LS_WHO = "urpfin_who";

  const S = {
    roomId: null,
    refs: null,
    who: localStorage.getItem(LS_WHO) || "",
    settings: { cashBalance: 0, cashAsOf: nowYm(), horizonMonths: 24, activeScenarioId: null },
    scenarios: [],
    expenses: [],
    actuals: {},
    compareIds: [],   // 비교 모드 선택 (로컬 상태)
    compareOn: false
  };

  const CATEGORIES = ["인건비", "AI 도구", "서버·인프라", "소프트웨어", "마케팅", "사무·운영", "기타"];
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
      if (snap.exists) Object.assign(S.settings, snap.data());
      FB.setSync("on", "실시간 연결됨");
      onChange("settings");
    }, firstErr));

    unsubs.push(refs.scenarios.onSnapshot(function (qs) {
      S.scenarios = qs.docs.map(function (d) { const o = d.data(); o.id = d.id; return o; })
        .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
      if (!S.settings.activeScenarioId && S.scenarios.length) {
        S.settings.activeScenarioId = S.scenarios[0].id;
      }
      onChange("scenarios");
    }, firstErr));

    unsubs.push(refs.expenses.onSnapshot(function (qs) {
      S.expenses = qs.docs.map(function (d) { const o = d.data(); o.id = d.id; return o; })
        .sort(function (a, b) {
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

  function saveSettings(patch) {
    Object.assign(S.settings, patch);
    return S.refs.settings.set(stamp(Object.assign({}, patch)), { merge: true });
  }

  // 시나리오: 슬라이더 드래그가 많으므로 id별 800ms 디바운스
  const scnTimers = {};
  function saveScenarioDebounced(sc) {
    clearTimeout(scnTimers[sc.id]);
    scnTimers[sc.id] = setTimeout(function () { saveScenarioNow(sc); }, 800);
  }
  function saveScenarioNow(sc) {
    const data = Object.assign({}, sc); delete data.id;
    return S.refs.scenarios.doc(sc.id).set(stamp(data));
  }
  function deleteScenario(id) { return S.refs.scenarios.doc(id).delete(); }

  function saveExpense(exp) {
    const data = Object.assign({}, exp); const id = data.id; delete data.id;
    return S.refs.expenses.doc(id).set(stamp(data));
  }
  function deleteExpense(id) {
    if (id === SALARY_ID) return Promise.reject(new Error("인건비 합계는 삭제할 수 없어요."));
    return S.refs.expenses.doc(id).delete();
  }

  function saveActual(ym, data) {
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
    return { id: SALARY_ID, name: "인건비 합계", category: "인건비", isSalaryTotal: true, amount: 0, cycle: "monthly", memo: "개인별 급여는 비공개, 합계만", order: -1 };
  }

  window.STORE = {
    S: S, CATEGORIES: CATEGORIES, TEAM: TEAM, SALARY_ID: SALARY_ID,
    connectRoom: connectRoom, nowYm: nowYm,
    saveSettings: saveSettings,
    saveScenarioDebounced: saveScenarioDebounced, saveScenarioNow: saveScenarioNow, deleteScenario: deleteScenario,
    saveExpense: saveExpense, deleteExpense: deleteExpense, saveActual: saveActual,
    activeScenario: activeScenario, newId: newId, setWho: setWho,
    defaultScenario: defaultScenario, defaultSalary: defaultSalary
  };
})();
