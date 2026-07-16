/* firebase.js — 회사 프로젝트(yourprofessor-94a2d) Firestore 연결.
   config는 공개돼도 안전한 값 — 보안은 Firestore 규칙 + 비밀 경로(roomId)가 담당. */
(function () {
  "use strict";

  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyD0ObaK3aKotOjKjtg1MGz_SB4qHX0DhdA",
    authDomain: "yourprofessor-94a2d.firebaseapp.com",
    projectId: "yourprofessor-94a2d",
    storageBucket: "yourprofessor-94a2d.firebasestorage.app",
    messagingSenderId: "307018527457",
    appId: "1:307018527457:web:83c46611055283c427bda0"
  };

  let db = null;
  let storage = null;

  function ensureApp() {
    if (!db) {
      firebase.initializeApp(FIREBASE_CONFIG);
      db = firebase.firestore();
      try { db.enablePersistence({ synchronizeTabs: true }).catch(function () {}); } catch (e) {}
    }
    return db;
  }

  // 영수증/증빙 업로드용 Storage 참조. fin_rooms/{roomId}/receipts/ 아래만 사용
  // (규칙은 room이 64자 hex일 때만 허용 — Firestore 비밀 경로 모델과 동일).
  function receiptRef(roomId, filename) {
    ensureApp();
    if (!storage) storage = firebase.storage();
    const safe = filename.replace(/[^\w.\-가-힣]/g, "_");
    return storage.ref("fin_rooms/" + roomId + "/receipts/" + Date.now() + "_" + safe);
  }

  // roomId 확정 후 각 컬렉션 핸들 반환. fin_rooms/{roomId} 문서 자체는 절대 만들지 않는다(열람 차단 유지).
  function roomRefs(roomId) {
    const d = ensureApp();
    const base = d.collection("fin_rooms").doc(roomId);
    return {
      meta: base.collection("meta").doc("room"),
      settings: base.collection("settings").doc("global"),
      scenarios: base.collection("scenarios"),
      expenses: base.collection("expenses"),
      actuals: base.collection("actuals")
    };
  }

  function setSync(state, text) {
    const el = document.getElementById("syncDot");
    const tx = document.getElementById("syncTx");
    if (!el) return;
    el.classList.remove("on", "err");
    if (state === "on") el.classList.add("on");
    if (state === "err") el.classList.add("err");
    if (tx) tx.textContent = text || "";
  }

  window.FB = { ensureApp: ensureApp, roomRefs: roomRefs, setSync: setSync, receiptRef: receiptRef };
})();
