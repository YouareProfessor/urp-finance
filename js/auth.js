/* auth.js — 비밀번호 → SHA-256 roomId 파생, 방 검증/생성, 잠금·해제.
   보안 경계 = 경로 비밀. 오답이면 아무것도 쓰지 않고 거부한다. */
(function () {
  "use strict";

  const LS_PW = "urpfin_pw";
  const SALT = "urpfin-v1|";

  async function deriveRoomId(pw) {
    const data = new TextEncoder().encode(SALT + pw.trim());
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash)).map(function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  }

  function isSetupMode() {
    return new URLSearchParams(location.search).get("setup") === "1";
  }

  // 성공 시 {roomId, refs} 반환, 실패 시 Error throw
  async function tryUnlock(pw) {
    if (!pw || !pw.trim()) throw new Error("비밀번호를 입력해 주세요.");
    const roomId = await deriveRoomId(pw);
    const refs = FB.roomRefs(roomId);
    let snap;
    try {
      snap = await refs.meta.get();
    } catch (e) {
      throw new Error("연결에 실패했어요. 인터넷을 확인해 주세요.");
    }
    if (!snap.exists) {
      if (isSetupMode()) {
        const ok = confirm("이 비밀번호로 새 재무 보드를 만들까요?\n(팀과 공유할 비밀번호인지 다시 확인해 주세요)");
        if (!ok) throw new Error("생성을 취소했어요.");
        await refs.meta.set({
          app: "urp-finance", schemaVersion: 1,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      } else {
        throw new Error("비밀번호가 올바르지 않아요.");
      }
    }
    localStorage.setItem(LS_PW, pw.trim());
    return { roomId: roomId, refs: refs };
  }

  function savedPw() { return localStorage.getItem(LS_PW) || ""; }

  function lockNow() {
    localStorage.removeItem(LS_PW);
    location.reload();
  }

  window.AUTH = { tryUnlock: tryUnlock, savedPw: savedPw, lockNow: lockNow, isSetupMode: isSetupMode };
})();
