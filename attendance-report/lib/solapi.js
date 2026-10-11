// 솔라피 카카오 알림톡 (선택 모듈). 미설정이면 조용히 건너뛴다 — 나머지 기능엔 영향 없음.
// 필요한 환경변수:
//   SOLAPI_API_KEY, SOLAPI_API_SECRET, SOLAPI_SENDER(발신번호), SOLAPI_PFID(=2차의 SOLAPI_PF_ID도 인정)
//   TPL_CHECKIN / TPL_CHECKOUT / TPL_LATE / TPL_DAILY / TPL_REPORT (검수 통과한 템플릿 ID)
//
// 템플릿 변수는 세미나2와 동일:
//   등원 #{학생이름}#{등원시간}#{하원시간} · 하원 #{학생이름}#{하원시간}
//   미등원 #{학생이름}#{예정시간}
//   데일리리포트 #{학생이름}#{날짜}#{진도}#{태도}#{과제}#{단어테스트}#{추가사항}
//   월말 #{학생이름}#{연월}#{링크}

import crypto from "node:crypto";

const API = "https://api.solapi.com/messages/v4/send-many";

// 카카오 채널 pfId — 6차 이름(SOLAPI_PFID)이 기본, 2차 세미나 때 쓰던 이름(SOLAPI_PF_ID)도 그대로 인정.
// (2·3차 수강생이 예전 메모를 그대로 붙여넣어도 동작하게. 둘 다 없을 때만 미설정으로 본다)
export function solapiPfId() {
  return process.env.SOLAPI_PFID || process.env.SOLAPI_PF_ID || "";
}

export function solapiConfigured() {
  return Boolean(
    process.env.SOLAPI_API_KEY &&
    process.env.SOLAPI_API_SECRET &&
    process.env.SOLAPI_SENDER &&
    solapiPfId()
  );
}

export const TPL = {
  checkin: process.env.TPL_CHECKIN,
  checkout: process.env.TPL_CHECKOUT,
  late: process.env.TPL_LATE,
  daily: process.env.TPL_DAILY,   // 데일리 리포트 (학부모 발송)
  report: process.env.TPL_REPORT, // 월말평가서
};

function authHeader() {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(32).toString("hex");
  const signature = crypto
    .createHmac("sha256", (process.env.SOLAPI_API_SECRET || "").trim())
    .update(date + salt)
    .digest("hex");
  return `HMAC-SHA256 apiKey=${(process.env.SOLAPI_API_KEY || "").trim()}, date=${date}, salt=${salt}, signature=${signature}`;
}

// 성공/실패와 무관하게 절대 throw 하지 않는다 (알림톡 실패가 출결을 막으면 안 됨).
export async function sendAlimtalk(to, templateId, variables) {
  if (!solapiConfigured()) return { skipped: true, reason: "미설정" };
  if (!templateId) return { skipped: true, reason: "템플릿ID 없음" };
  const phone = String(to || "").replace(/[^0-9]/g, "");
  if (phone.length < 10) return { skipped: true, reason: "연락처 없음" };

  const body = {
    messages: [
      {
        to: phone,
        from: String(process.env.SOLAPI_SENDER).replace(/[^0-9]/g, ""),
        kakaoOptions: {
          pfId: solapiPfId(),
          templateId,
          variables: variables || {},
          disableSms: false, // 실패 시 문자 대체
        },
      },
    ],
  };
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { Authorization: authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (data.failedMessageList && data.failedMessageList.length > 0) {
      return { success: false, reason: data.failedMessageList[0].reason || "발송 실패" };
    }
    return { success: res.ok, detail: data };
  } catch (e) {
    return { success: false, reason: String(e.message || e) };
  }
}
