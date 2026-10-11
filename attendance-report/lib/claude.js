// Claude(Anthropic) Messages API — 월말평가서 생성.
// ★ 2차(앱스크립트) 세미나에서 실제로 쓰던 지침·데이터요약 형식을 그대로 이식했습니다 ★
//   → 평가서 말투·형식이 기존과 동일하게 나오도록. (숫자 금지·"~이는" 호칭·plain text 등)
//   바꾸고 싶으면: 모델 = MODEL 한 줄 / 지침 = reportGuideline() / 데이터형식 = buildDataSummary()

const MODEL = "claude-sonnet-5"; // 품질↑ "claude-opus-5" / 저렴 "claude-haiku-4-5"
const API = "https://api.anthropic.com/v1/messages";

export function claudeConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function periodLabelOf(month) {
  const [y, m] = String(month).split("-");
  return `${y}년 ${parseInt(m, 10)}월`;
}

// 월말평가서 작성 지침 (2차 배포본 getReportGuideline 이식)
export function reportGuideline() {
  return [
    "당신은 학원 선생님으로서 학부모에게 보내는 학생의 월간 학습 리포트를 작성합니다.",
    "",
    "★★★ 절대 금지 사항 (최우선) ★★★",
    "1. 마크다운/서식 기호 일체 사용 금지: #, ##, ###, **, *, -, 글머리 기호 모두 금지.",
    "   제목도 기호 없이 순수 텍스트로만 쓰세요.",
    '2. 구체적 숫자/횟수 금지: "18회 수업", "15회 중 14회 통과", "93%" 같은 구체적 숫자를 쓰지 마세요.',
    '   대신 "거의 매 수업 빠짐없이 출석", "대부분의 단어 테스트를 통과", "꾸준히 과제를 완료" 같은 대략적 표현을 쓰세요.',
    '3. "~학생"이라는 호칭 금지. 반드시 "~이는" 또는 "~는" 형태로 부르세요.',
    '   두 글자 이름이면 "~는"(예: "수호는"), 세 글자 이름이면 "~이는"(예: "태민이는").',
    "",
    "[기본 구조]",
    "첫 줄에 리포트 제목을 쓰되 기호 없이 텍스트로만.",
    "본문은 자연스러운 문단으로 이어서 작성. 섹션 제목이나 구분선 없이 흐르듯이.",
    '절대 포함 금지: "최종 진도" 섹션, "데이터 검증" 섹션, 담당교사 정보, 메타데이터 표.',
    "",
    "[날짜/진도 표기]",
    "금지: 구체적 날짜(1월 5일), 세부 유닛번호(Unit 12, Day 38, CH 3).",
    "사용: 시기 표현(초반, 중순, 후반), 내용 중심(비교급과 최상급을 학습).",
    "",
    "[교재 전환 표기 - 중요]",
    "교재 전환 내역이 제공되면 반드시 본문에 자연스럽게 언급하세요.",
    '예시: "문법 교재인 시제스타터 1을 마무리하고, 시제스타터 2로 넘어가 학습을 이어가고 있습니다."',
    "교재명은 그대로 사용하되, 유닛번호나 Day번호는 언급하지 마세요.",
    "",
    "[영역별 작성]",
    "리딩: 교재명과 학습 방법 중심. 문장 해석, 주어·동사 찾기, 문단 요약 등.",
    "문법: 학습한 문법 개념을 자연스럽게 서술(챕터 번호 없이). 이해도와 문제점 중심.",
    '단어: "꾸준히 통과하고 있습니다", "간혹 재시험을 보기도 했습니다" 같은 대략적 경향만.',
    "",
    "[출석/태도/과제 표현 방법]",
    '절대로 "16회 수업 중 15회 정시 출석" 같은 구체적 숫자를 쓰지 마세요.',
    '대신 "거의 빠짐없이 정시에 등원하고 있습니다", "수업 태도가 대체로 양호합니다", "과제 완수율이 높은 편입니다" 등 자연스러운 문장을 쓰세요.',
    "지각이나 결석이 거의 없으면 굳이 언급하지 마세요.",
    "",
    "[금지 사항]",
    "과제 미이행 1~2회, 교재 미지참, 지각 1~2회, 컨디션 문제 같은 일회성 지적 금지.",
    "재시험 날짜, 점수 세부(100점, 90점), 방학 특강 시간 금지.",
    "",
    "[중학생 대상]",
    "선생님 참고사항에 중학생이라고 표시된 경우: 내신 대비, 수행평가, 서술형 문제 대비 언급 필수.",
    "",
    "[다음달 계획]",
    "교재 진행 방향(구체적 챕터 없이), 학습 방향(복습/심화), 개선 목표 포함.",
    "",
    "[학부모 안내 멘트]",
    "리포트 마지막에 가정에서 도움이 될 실천 사항 1~2가지를 자연스럽게 안내.",
    "",
    "[형식]",
    "800~1000자. 순수 텍스트만(plain text). #, **, * 등 기호 일체 금지.",
    "선생님 1인칭. 자연스러운 문장 연결. 긍정적이되 개선점 명확히. 과도한 격려 문구 지양.",
    "단락 구분은 빈 줄로만 하세요.",
  ].join("\n");
}

// AI에 주는 데이터 요약 (2차 배포본 buildDataSummaryText 형식 이식)
export function buildDataSummary({ studentName, periodLabel, planner, comment, dailyNotes }) {
  const p = planner;
  const L = [];
  L.push("【학생명】" + studentName);
  L.push("【평가기간】" + periodLabel);
  L.push("");
  L.push(`【출석】총 ${p.총수업일수}일 중 정시 ${p.출석.정시등원}회, 지각 ${p.출석.지각}회, 결석 ${p.출석.결석}회`);
  L.push(`【태도】상 ${p.태도.상}회, 중 ${p.태도.중}회, 하 ${p.태도.하}회`);
  L.push("");
  if (p.단어테스트.총횟수 > 0) {
    const rate = Math.round((p.단어테스트.통과 / p.단어테스트.총횟수) * 100);
    L.push(`【단어테스트】${p.단어테스트.총횟수}회 중 통과 ${p.단어테스트.통과}회 (${rate}%)`);
  } else {
    L.push("【단어테스트】기록 없음");
  }
  L.push("");
  L.push("【진도 현황 - 월초 → 최종】");
  for (const 영역 of ["문법", "리딩", "단어"]) {
    const 월초 = p.월초진도[영역];
    const 최종 = p.최종진도[영역];
    if (!최종) continue;
    const 최종유닛 = [최종.유닛코드, 최종.제목].filter(Boolean).join(" ");
    let line = 영역 + ": ";
    if (월초 && 월초.교재명 !== 최종.교재명) {
      line += `${월초.교재명} → ${최종.교재명} ${최종유닛}`;
    } else {
      line += `${최종.교재명} ${최종유닛}`;
    }
    L.push(line);
  }
  L.push("");
  if (p.교재전환 && p.교재전환.length > 0) {
    L.push("【교재 전환 내역】(이전 교재 완료 후 새 교재 시작)");
    p.교재전환.forEach((t) => L.push(`- ${t.영역}: "${t.이전교재}" 마무리 → "${t.새교재}" 시작`));
    L.push("");
  }
  const hw = p.과제 || { 상: 0, 중: 0, 하: 0 };
  const hwTotal = hw.상 + hw.중 + hw.하;
  if (hwTotal > 0) {
    const hwPct = Math.round((hw.상 / hwTotal) * 100);
    L.push(`【과제 수행도】상 ${hw.상}회, 중 ${hw.중}회, 하 ${hw.하}회 (상 비율 ${hwPct}%)`);
  } else {
    L.push("【과제 수행도】기록 없음");
  }
  if (dailyNotes && dailyNotes.length > 0) {
    L.push("");
    L.push("【데일리 지적사항 모음】(그 달 매일 기록된 특이사항 — 반복되는 패턴만 자연스럽게 반영, 일회성은 제외)");
    dailyNotes.forEach((n) => L.push(`- ${n}`));
  }
  if (comment) {
    L.push("");
    L.push("【선생님 참고사항】");
    L.push(comment);
  }
  return L.join("\n");
}

export async function generateReport({ student, month, planner, comment, dailyNotes }) {
  const periodLabel = periodLabelOf(month);
  const system = reportGuideline();
  const data = buildDataSummary({ studentName: student.name, periodLabel, planner, comment, dailyNotes });
  const user = `${student.name} 학생의 ${periodLabel} Daily report 데이터입니다. 학습 리포트를 작성해주세요.\n\n${data}`;

  const res = await fetch(API, {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`Claude 호출 실패: ${res.status} ${await res.text()}`);
  const d = await res.json();
  return (d.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}
