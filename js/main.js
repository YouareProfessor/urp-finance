/* main.js — 부팅, 잠금 흐름, 탭 라우터, 이름 선택, 토스트. */
(function () {
  "use strict";
  const S = STORE.S;

  // ---- 토스트 ----
  let toastTimer = null;
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("on"); }, 2600);
  }

  // ---- 오버레이 ----
  function openOverlay(id) { document.getElementById(id).classList.add("on"); }
  function closeOverlays() {
    document.querySelectorAll(".overlay.on").forEach(function (o) { o.classList.remove("on"); });
  }
  document.querySelectorAll(".overlay").forEach(function (o) {
    o.addEventListener("click", function (e) { if (e.target === o) closeOverlays(); });
  });
  document.querySelectorAll("[data-close]").forEach(function (b) {
    b.addEventListener("click", closeOverlays);
  });

  // ---- 탭 ----
  const RENDERERS = {
    dashboard: function () { UI_DASH.render(); },
    simulator: function () { UI_SIM.render(); },
    apicost: function () { UI_APICOST.render(); },
    expenses: function () { UI_EXPENSES.render(); },
    pnl: function () { UI_PNL.render(); },
    excel: function () { UI_EXCEL.render(); }
  };
  let currentTab = "dashboard";

  function goTab(name) {
    if (!RENDERERS[name]) return;
    currentTab = name;
    document.querySelectorAll("nav.tabs button").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-tab") === name);
    });
    document.querySelectorAll("section.tab").forEach(function (s) {
      s.classList.toggle("on", s.id === "tab-" + name);
    });
    CHARTS.tipHide();
    RENDERERS[name]();
    scrollTo({ top: 0, behavior: "smooth" });
  }

  document.querySelectorAll("nav.tabs button").forEach(function (b) {
    b.addEventListener("click", function () { goTab(b.getAttribute("data-tab")); });
  });

  // ---- 데이터 변경 → 현재 탭 다시 그림 ----
  // 단, 사용자가 입력 중(슬라이더 드래그·타이핑)이면 재렌더를 미뤘다가 입력이 끝나면 그림
  let pendingRender = false;
  function isEditing() {
    const ae = document.activeElement;
    return ae && (ae.tagName === "INPUT" || ae.tagName === "SELECT" || ae.tagName === "TEXTAREA") &&
      ae.closest("main") && ae.type !== "file";
  }
  function onDataChange() {
    // 최초 시나리오 자동 생성 (설정·시나리오 로드 후 1회)
    if (S.refs && S.scenarios.length === 0 && !onDataChange._seeded && onDataChange._scnLoaded) {
      onDataChange._seeded = true;
      STORE.saveScenarioNow(STORE.defaultScenario(0));
    }
    if (isEditing()) { pendingRender = true; return; }
    RENDERERS[currentTab]();
  }
  document.addEventListener("focusout", function () {
    if (!pendingRender) return;
    setTimeout(function () {
      if (pendingRender && !isEditing()) { pendingRender = false; RENDERERS[currentTab](); }
    }, 150);
  });

  // ---- 이름 선택 ----
  function renderWhoChip() {
    document.getElementById("whoChip").textContent = S.who ? S.who : "이름 선택";
  }
  function openWho() {
    const grid = document.getElementById("nameGrid");
    grid.innerHTML = STORE.TEAM.map(function (n) {
      return "<button data-n='" + n + "'>" + n + "</button>";
    }).join("");
    grid.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () {
        STORE.setWho(b.getAttribute("data-n"));
        renderWhoChip(); closeOverlays();
        toast(S.who + "님, 반가워요");
      });
    });
    openOverlay("whoModal");
  }
  document.getElementById("whoChip").addEventListener("click", openWho);
  document.getElementById("lockBtn").addEventListener("click", function () {
    if (confirm("저장된 비밀번호를 지우고 잠글까요?")) AUTH.lockNow();
  });

  // ---- 잠금 해제 흐름 ----
  const lockEl = document.getElementById("lock");
  const lockMsg = document.getElementById("lockMsg");

  function unlocked(res) {
    lockEl.style.display = "none";
    document.getElementById("app").hidden = false;
    renderWhoChip();
    let scnFirst = true;
    STORE.connectRoom(res.roomId, res.refs, function (kind) {
      if (kind === "scenarios" && scnFirst) { scnFirst = false; onDataChange._scnLoaded = true; }
      onDataChange();
    });
    if (!S.who) setTimeout(openWho, 600);
  }

  document.getElementById("lockForm").addEventListener("submit", function (e) {
    e.preventDefault();
    const pw = document.getElementById("pwInput").value;
    lockMsg.textContent = "";
    AUTH.tryUnlock(pw).then(unlocked).catch(function (err) {
      lockMsg.textContent = err.message;
      lockEl.classList.remove("shake");
      void lockEl.offsetWidth;
      lockEl.classList.add("shake");
    });
  });

  // ---- 부팅 ----
  if (AUTH.isSetupMode()) document.getElementById("setupNote").hidden = false;
  const saved = AUTH.savedPw();
  if (saved && !AUTH.isSetupMode()) {
    AUTH.tryUnlock(saved).then(unlocked).catch(function () {
      // 저장된 비밀번호가 더는 안 맞으면 잠금 화면 유지
      localStorage.removeItem("urpfin_pw");
    });
  }

  // 각 화면 1회 초기화
  UI_EXPENSES.init(); UI_SIM.init(); UI_PNL.init(); UI_DASH.init(); UI_EXCEL.init();

  window.MAIN = { toast: toast, goTab: goTab, openOverlay: openOverlay, closeOverlays: closeOverlays };
})();
