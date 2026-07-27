/* ui-apicost.js — API 변동원가 인터랙티브 보드.
   사용자 구성(세그먼트) × 기능별 단가(개념과외/문제풀이/시험) → 인당 월원가 → 손익 자동 반영.
   기본값은 니가교수 앱 코드 구조 기반 시뮬레이션(2026-07-16), 실측 아님 — Worker+D1 로깅 도입 후 실측치로 교체 예정. */
(function () {
  "use strict";
  const S = STORE.S;
  const esc = function (s) { return UI_EXPENSES.esc(s); };

  function cm() { return S.settings.costModel; }
  function save() {
    STORE.saveSettingsDebounced({ costModel: cm(), fxRate: S.settings.fxRate });
    // API 원가 탭이 아닌 다른 탭(주로 수익 시뮬레이터)에서 빠른조정 팝업으로 값을 바꿨을 때,
    // Firestore 왕복(800ms 디바운스)을 기다리지 않고 그 탭 화면을 바로 갱신한다.
    const cur = window.MAIN && MAIN.getCurrentTab && MAIN.getCurrentTab();
    if (cur === "simulator" && window.UI_SIM && UI_SIM.renderResult) UI_SIM.renderResult();
  }

  function render() {
    renderSegments("apiSegments");
    renderTech();
    renderResults();
  }

  // ---- 왼쪽: 사용자 구성 (containerId를 주면 팝업 등 다른 곳에도 그대로 그릴 수 있음) ----
  function renderSegments(containerId) {
    const box = document.getElementById(containerId || "apiSegments");
    const cid = containerId || "apiSegments";
    const sum = cm().segments.reduce(function (a, s) { return a + (s.pct || 0); }, 0);
    const bench = CALC.INDUSTRY_BENCHMARK;
    let html = "<div style='display:flex; align-items:center; gap:10px; flex-wrap:wrap;'>" +
      "<h3 style='font-size:16px; flex:1;'>사용자 구성 <span class='mini-note'>전체 유료 사용자를 유형별로 나눕니다</span></h3>" +
      "<button class='btn ghost sm' data-segbench>● 업계 표준으로 맞추기</button></div>" +
      "<p class='mini-note' style='margin-top:4px;'>진한 점 = 업계 표준 비율 · " + esc(bench.source) + "</p>";
    cm().segments.forEach(function (seg, i) {
      html += "<div class='stream-card' data-si='" + i + "'>" +
        "<div class='st-head'><input value='" + esc(seg.name) + "' data-k='name' />" +
        (cm().segments.length > 1 ? "<button class='icon-btn' data-delseg='" + i + "'>✕</button>" : "") + "</div>" +
        segParam(i, "pct", "비율 (%)", seg.pct, 0, 100, 1, bench.bySegmentName[seg.name]) +
        segParam(i, "tutorPerMonth", "월 개념과외 (개)", seg.tutorPerMonth, 0, 60, 1) +
        segParam(i, "studyPerMonth", "월 복습카드 (개)", seg.studyPerMonth, 0, 1000, 10) +
        segParam(i, "examPerMonth", "월 시험 (회)", seg.examPerMonth, 0, 20, 1) +
        "</div>";
    });
    html += "<div style='margin-top:12px; display:flex; align-items:center; gap:10px;'>" +
      "<button class='btn sm' data-segadd>+ 유형 추가</button>" +
      "<span class='mini-note'>비율 합계 " + sum + "%" + (sum !== 100 ? " — 100%가 아니면 비율대로 자동 환산해요" : "") + "</span></div>";
    box.innerHTML = html;

    box.querySelectorAll(".stream-card").forEach(function (card) {
      const i = Number(card.getAttribute("data-si"));
      card.querySelectorAll("input[data-k]").forEach(function (inp) {
        inp.addEventListener("input", function () {
          const k = inp.getAttribute("data-k");
          if (k === "name") { cm().segments[i].name = inp.value; }
          else {
            const v = Number(inp.value) || 0;
            cm().segments[i][k] = v;
            card.querySelectorAll("input[data-k='" + k + "']").forEach(function (t) { if (t !== inp) t.value = v; });
          }
          save(); renderResults();
        });
      });
      const del = card.querySelector("[data-delseg]");
      if (del) del.addEventListener("click", function () {
        if (!confirm("‘" + cm().segments[i].name + "’ 유형을 삭제할까요?")) return;
        cm().segments.splice(i, 1); save(); renderSegments(cid);
      });
    });
    box.querySelector("[data-segadd]").addEventListener("click", function () {
      cm().segments.push({ name: "새 유형", pct: 10, tutorPerMonth: 4, studyPerMonth: 100, examPerMonth: 1 });
      save(); renderSegments(cid);
    });
    box.querySelector("[data-segbench]").addEventListener("click", function () {
      let matched = 0;
      cm().segments.forEach(function (seg) {
        const b = bench.bySegmentName[seg.name];
        if (b != null) { seg.pct = b; matched++; }
      });
      if (!matched) { MAIN.toast("이름이 열정/일반/유령 학생과 달라 매칭되는 유형이 없어요"); return; }
      save(); renderSegments(cid);
      MAIN.toast("업계 표준 비율로 맞췄어요");
    });
  }

  function segParam(i, k, label, v, min, max, step, benchmarkPct) {
    const marker = benchmarkPct != null
      ? "<div class='bench-mark' style='left:" + (benchmarkPct - min) / (max - min) * 100 + "%' title='업계 표준 " + benchmarkPct + "%'></div>"
      : "";
    return "<div class='param'><div class='p-lb'><span>" + label + "</span>" +
      "<input type='number' data-k='" + k + "' value='" + (v || 0) + "' min='" + min + "' max='" + max + "' step='" + step + "' /></div>" +
      "<div class='range-wrap'>" +
      "<input type='range' data-k='" + k + "' value='" + (v || 0) + "' min='" + min + "' max='" + max + "' step='" + step + "' />" +
      marker + "</div></div>";
  }

  // ---- 오른쪽 위: 기술·단가 가정 (기능별) ----
  function renderTech() {
    const box = document.getElementById("apiTech");
    const c = cm();
    const M = CALC.MEASURED;
    const isMeasured = FEATURE_ORDER.every(function (k) { return c.features[k].wonPerUnit === M[k].wonPerUnit; });
    box.innerHTML =
      "<div style='display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;'>" +
      "<h3 style='font-size:16px; flex:1;'>기능별 단가" +
      (isMeasured ? " <span class='mini-note'>실측 반영됨 (" + M.at + ")</span>"
                  : " <span class='mini-note'>지금은 우리가 직접 넣은 값</span>") + "</h3>" +
      (isMeasured ? "" : "<button class='btn ghost sm' id='useMeasured'>📏 실측값으로 갱신</button>") +
      "</div>" +
      "<p class='mini-note' style='margin:6px 0 12px;'>실측 출처: " + esc(M.source) +
      ". 문제풀이 " + M.study.wonPerUnit + "원(" + esc(M.study.sample) + ") · 개념과외 " + M.tutor.wonPerUnit +
      "원(" + esc(M.tutor.sample) + ") · 시험 " + M.exam.wonPerUnit + "원(" + esc(M.exam.sample) + "). " +
      "표본이 작으니 베타에서 다시 잰다.</p>" +
      featureRows(c) +
      techParam("savingPct", "토큰 절감률 (%) — 캐시 활용·모델 라우팅 등으로 전 기능에 균일 적용", c.savingPct, 0, 90, 5) +
      techParam("freeUsers", "무료 제공 사용자 — PK/MK (선교사·사역자 자녀, 매출 없음)", c.freeUsers, 0, 3000, 50) +
      "<p class='mini-note' style='margin-top:-6px;'>광고로 돈을 버는 무료 사용자는 여기가 아니라 ‘수익 시뮬레이터’에서 수익원을 ‘광고형’으로 추가하세요.</p>" +
      "<div class='fld-row' style='margin-top:14px;'>" +
      "<div class='fld'><label>환율 (원/달러)</label><input type='number' id='fxRate' value='" + (S.settings.fxRate || 1400) + "' step='10' /></div>" +
      "<div class='fld'><label>결제 수수료율 (%)</label><input type='number' id='feeRate' value='" + Math.round((c.feeRate || 0) * 1000) / 10 + "' step='0.1' min='0' max='30' /></div>" +
      "</div>";

    bindFeatureInputs(box, renderResults);
    box.querySelectorAll("input[data-t]").forEach(function (inp) {
      inp.addEventListener("input", function () {
        const k = inp.getAttribute("data-t");
        const v = Number(inp.value) || 0;
        cm()[k] = v;
        box.querySelectorAll("input[data-t='" + k + "'][data-g='top']").forEach(function (t) { if (t !== inp) t.value = v; });
        save(); renderResults();
      });
    });
    // 실측값 적용은 버튼을 눌러야만 일어난다 — 팀이 손으로 맞춰둔 값을 배포만으로 갈아치우지 않기 위해서.
    const um = document.getElementById("useMeasured");
    if (um) um.addEventListener("click", function () {
      const cur = FEATURE_ORDER.map(function (k) { return c.features[k].name + " " + c.features[k].wonPerUnit + "원 → " + M[k].wonPerUnit + "원"; }).join("\n");
      if (!confirm("기능별 단가를 실측값으로 바꿀까요?\n\n" + cur + "\n\n출처: " + M.source)) return;
      FEATURE_ORDER.forEach(function (k) { cm().features[k].wonPerUnit = M[k].wonPerUnit; });
      save(); renderTech(); renderResults();
      MAIN.toast("실측값으로 갱신했어요");
    });
    document.getElementById("fxRate").addEventListener("input", function () {
      S.settings.fxRate = Number(this.value) || 1400; save(); renderResults();
    });
    document.getElementById("feeRate").addEventListener("input", function () {
      cm().feeRate = (Number(this.value) || 0) / 100; save(); renderResults();
    });
  }

  // 기능별(개념과외/문제풀이/시험) 단가 입력 행 — apiTech·빠른조정 팝업 공용
  function featureRows(c) {
    let html = "";
    FEATURE_ORDER.forEach(function (k) {
      const f = c.features[k];
      html += "<div class='param'><div class='p-lb'><span>" + esc(f.name) + " <span class='mini-note'>(" + esc(f.unitLabel) + ")</span></span>" +
        "<input type='number' data-feat='" + k + "' value='" + (f.wonPerUnit || 0) + "' min='0' step='1' /></div>" +
        "<input type='range' data-feat='" + k + "' value='" + (f.wonPerUnit || 0) + "' min='0' max='400' step='1' /></div>";
    });
    return html;
  }
  function bindFeatureInputs(box, onChange) {
    box.querySelectorAll("input[data-feat]").forEach(function (inp) {
      inp.addEventListener("input", function () {
        const k = inp.getAttribute("data-feat");
        const v = Number(inp.value) || 0;
        cm().features[k].wonPerUnit = v;
        box.querySelectorAll("input[data-feat='" + k + "']").forEach(function (t) { if (t !== inp) t.value = v; });
        save(); onChange();
      });
    });
  }
  const FEATURE_ORDER = ["tutor", "study", "exam"];

  // 빠른조정 팝업용 — 기능별 단가 + 절감률·PK/MK + 실시간 인당원가 미리보기. 세부(환율·수수료 등)는 API 원가 탭에서.
  function renderTechQuick(containerId) {
    const box = document.getElementById(containerId);
    if (!box) return;
    const c = cm();
    box.innerHTML =
      featureRows(c) +
      techParam("savingPct", "토큰 절감률 (%)", c.savingPct, 0, 90, 5) +
      techParam("freeUsers", "무료 제공 사용자 — PK/MK", c.freeUsers, 0, 3000, 50) +
      "<p class='mini-note' id='acmPreview' style='margin-top:10px; font-weight:700;'></p>";

    function refreshPreview() {
      const cu = CALC.costPerUser(cm(), S.settings.fxRate);
      const p = box.querySelector("#acmPreview");
      if (p) p.textContent = "인당 월 원가(가중평균): " + CALC.fmtWon(cu.blended);
    }
    bindFeatureInputs(box, refreshPreview);
    box.querySelectorAll("input[data-t]").forEach(function (inp) {
      inp.addEventListener("input", function () {
        const k = inp.getAttribute("data-t");
        const v = Number(inp.value) || 0;
        cm()[k] = v;
        box.querySelectorAll("input[data-t='" + k + "']").forEach(function (t) { if (t !== inp) t.value = v; });
        save(); refreshPreview();
      });
    });
    refreshPreview();
  }

  function techParam(k, label, v, min, max, step) {
    return "<div class='param'><div class='p-lb'><span>" + label + "</span>" +
      "<input type='number' data-t='" + k + "' data-g='top' value='" + (v || 0) + "' min='" + min + "' step='" + step + "' /></div>" +
      "<input type='range' data-t='" + k + "' data-g='top' value='" + (v || 0) + "' min='" + min + "' max='" + max + "' step='" + step + "' /></div>";
  }

  // ---- 오른쪽 아래: 결과 ----
  function renderResults() {
    const box = document.getElementById("apiResults");
    const c = cm();
    const cu = CALC.costPerUser(c, S.settings.fxRate);
    const sc = STORE.activeScenario();

    // 활성 시나리오 이번 달(첫 달 아님 — 현재 월) 기준 규모
    let scaleHtml = "";
    let arpu = 0, users = 0;
    if (sc) {
      const rows = CALC.pnlSeries(sc, S.expenses, S.actuals, S.settings);
      const nowRow = rows.find(function (r) { return r.ym === STORE.nowYm(); }) || rows[0];
      users = nowRow.payingUsers;
      arpu = users > 0 ? nowRow.revenue / users : 0;
      const freeUsers = c.freeUsers || 0;
      const adsUsers = Math.max(0, nowRow.activeUsers - nowRow.payingUsers);
      const totalApiUsers = nowRow.activeUsers + freeUsers;
      // 유료(구독) 고객 1인당 실질 부담원가: 광고형·PK/MK 무료 사용자 몫까지 구독 고객이 나눠 짊어진다고 볼 때의 원가
      const realCostPerPayer = users > 0 ? nowRow.api / users : cu.blended;
      const contrib = arpu - arpu * (c.feeRate || 0) - realCostPerPayer;
      const costRatio = arpu > 0 ? Math.round(realCostPerPayer / arpu * 100) : null;
      scaleHtml =
        "<div class='tbl-wrap' style='margin-top:16px;'><table><tbody>" +
        rr("이번 달 구독(유료) 사용자 (" + esc(sc.name) + ")", users.toLocaleString("ko-KR") + "명") +
        rr("광고형 무료 사용자 <span class='mini-note'>(수익 시뮬레이터 수익원)</span>", adsUsers.toLocaleString("ko-KR") + "명") +
        rr("PK/MK 무료 사용자", freeUsers.toLocaleString("ko-KR") + "명") +
        rr("전체 API 사용자 (구독+광고형+PK/MK)", totalApiUsers.toLocaleString("ko-KR") + "명") +
        rr("이번 달 API 총비용", CALC.fmtWon(nowRow.api)) +
        rr("구독자 1인당 실질 부담원가 <span class='mini-note'>(무료 사용자 몫 포함)</span>", CALC.fmtWon(Math.round(realCostPerPayer))) +
        rr("인당 매출 (ARPU)", CALC.fmtWon(Math.round(arpu))) +
        rr("인당 공헌이익 (매출−수수료−실질 부담원가)",
          "<span class='" + (contrib >= 0 ? "pos" : "neg") + "'>" + CALC.fmtWon(Math.round(contrib)) + "</span>") +
        (costRatio != null ? rr("매출 대비 실질 원가율", costRatio + "%") : "") +
        "</tbody></table></div>";
    }

    let segRows = "";
    cu.perSeg.forEach(function (s) {
      segRows += "<tr><td>" + esc(s.name) + "</td><td class='num'>" + Math.round(s.pct / cu.sumPct * 100) + "%</td>" +
        "<td class='num'>" + s.tutorPerMonth.toLocaleString("ko-KR") + "개</td>" +
        "<td class='num'>" + s.studyPerMonth.toLocaleString("ko-KR") + "개</td>" +
        "<td class='num'>" + s.examPerMonth.toLocaleString("ko-KR") + "회</td>" +
        "<td class='num'>" + CALC.fmtWon(s.costMonth) + "</td></tr>";
    });
    const feat = c.features;

    box.innerHTML =
      "<div style='display:flex; align-items:center; gap:8px; flex-wrap:wrap;'>" +
      "<h3 style='font-size:16px; flex:1;'>원가 결과 <span class='mini-note'>실시간 계산 · 손익표에 자동 반영</span></h3>" +
      "<button class='btn ghost sm' id='goSimBtn'>→ 판매가격·전략 (수익 시뮬레이터)</button>" +
      "<button class='btn ghost sm' id='goExpBtn'>→ 고정지출</button></div>" +
      "<div class='kpis' style='grid-template-columns:repeat(3,1fr); margin-top:14px;'>" +
      kpi(feat.tutor.name + " 단가", CALC.fmtWonShort(Math.round(feat.tutor.wonPerUnit * cu.savingEff)),
        c.savingPct > 0 ? "−" + c.savingPct + "%" : null) +
      kpi(feat.study.name + " 단가", CALC.fmtWonShort(Math.round(feat.study.wonPerUnit * cu.savingEff)),
        c.savingPct > 0 ? "−" + c.savingPct + "%" : null) +
      kpi("인당 월 원가 (가중평균)", CALC.fmtWonShort(cu.blended)) +
      "</div>" +
      "<p class='mini-note' style='margin-top:10px;'>" + feat.exam.name + "(" + esc(feat.exam.unitLabel) + ") 단가 " +
      CALC.fmtWon(Math.round(feat.exam.wonPerUnit * cu.savingEff)) + " · 기본값은 코드 구조 기반 시뮬레이션(2026-07-16), 실측 아님</p>" +
      "<div class='tbl-wrap' style='margin-top:14px;'><table>" +
      "<thead><tr><th>유형</th><th>비율</th><th>월 개념과외</th><th>월 복습카드</th><th>월 시험</th><th>인당 월 원가</th></tr></thead>" +
      "<tbody>" + segRows + "</tbody></table></div>" +
      scaleHtml;

    document.getElementById("goSimBtn").addEventListener("click", function () { MAIN.goTab("simulator"); });
    document.getElementById("goExpBtn").addEventListener("click", function () { MAIN.goTab("expenses"); });

    function kpi(lb, v, tag) {
      return "<div class='kpi' style='cursor:default; padding:16px 18px;'>" +
        (tag ? "<span class='tag'><span class='badge pos'>" + tag + "</span></span>" : "") +
        "<div class='lb'>" + lb + "</div><div class='v num' style='font-size:20px;'>" + v + "</div></div>";
    }
    function rr(k, v) {
      return "<tr><td>" + k + "</td><td class='num' style='font-weight:700;'>" + v + "</td></tr>";
    }
  }

  window.UI_APICOST = {
    render: render, init: function () {},
    renderSegments: renderSegments, renderTechQuick: renderTechQuick
  };
})();
