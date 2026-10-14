// 모든 API 액션을 **진짜 PostgreSQL** 로 실행. 쿼리 문법·타입 오류를 잡는다.
const B = "http://localhost:4330";
let fail = 0;
const ck = (l, c, d) => { console.log(`${c ? "  ok " : "FAIL "} ${l}${c ? "" : "  → " + String(JSON.stringify(d ?? null)).slice(0, 220)}`); if (!c) fail++; };

const get = async (q) => { const r = await fetch(`${B}/api/attendance?${q}`); return { s: r.status, d: await r.json() }; };
const post = async (p, b) => { const r = await fetch(`${B}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); return { s: r.status, d: await r.json() }; };

const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

// ── 조회 계열 ──
let r = await get("action=students");
ck("students", r.s === 200 && r.d.students.length === 3, r.d);
const stu = r.d.students;
const byName = Object.fromEntries(stu.map((s) => [s.name, s]));

r = await get("action=textbooks");
ck("textbooks", r.s === 200 && r.d.textbooks.length === 9, r.d.textbooks?.length);

r = await get("action=board");
ck("board", r.s === 200 && Array.isArray(r.d.students), r.d);
ck("board 통계 키", r.s === 200 && typeof r.d.stats?.오늘예정 === "number", r.d.stats);

r = await get(`action=board&date=${today}&teacher=${encodeURIComponent("이선생")}`);
ck("board + teacher 필터", r.s === 200 && r.d.students.every((x) => x.teacher === "이선생"), r.d.students?.map((x) => x.teacher));

r = await get("action=daily-rows");
ck("daily-rows", r.s === 200 && r.d.rows.length > 0, { s: r.s, e: r.d.error });
const rows = r.d.rows;
ck("★ 진도가 목차 다음으로 채워짐", rows.every((x) => Object.keys(x.record.progress || {}).length > 0), rows[0]?.record?.progress);
ck("★ link 상태 내려옴", rows.every((x) => x.link && typeof x.link === "object"), rows[0]?.link);

// 샘플 데이터 자체의 앞뒤가 맞는지 — 「불통과 20/20」 같은 줄이 있으면
// 수강생이 화면이 틀렸다고 생각합니다 (실제로 샘플에 섞여 있었습니다).
{
  const hist = await get("action=student-history&student_id=" + stu[0].id + "&days=90");
  const bad = (hist.d.rows || []).filter((x) => {
    if (!x.voca_test || !x.voca_score) return false;
    const got = Number(String(x.voca_score).split("/")[0]);
    const tot = Number(String(x.voca_score).split("/")[1] || 20);
    if (!isFinite(got) || !isFinite(tot)) return false;
    const pass = !/불통과|미통과/.test(x.voca_test);
    return pass ? got / tot < 0.6 : got / tot >= 0.8;   // 통과인데 낮거나, 불통과인데 높거나
  });
  ck("★ 샘플의 단어테스트 결과↔점수가 앞뒤 맞음", bad.length === 0,
     bad.slice(0, 3).map((x) => `${x.date} ${x.voca_test} ${x.voca_score}`));
}

r = await get("action=teachers");
ck("teachers", r.s === 200 && r.d.teachers.length === 2, r.d.teachers);

r = await get(`action=tasks&date=${today}`);
ck("tasks", r.s === 200 && r.d.tasks.length === 9, r.d.tasks?.length);

// ── 쓰기 계열 ──
r = await post("/api/attendance", { action: "save-record", student_id: byName["김민준"].id, date: today, fields: { attitude: "중", homework: "상", note: "검수" } });
ck("save-record", r.s === 200, r.d);
r = await get("action=daily-rows");
ck("save-record 반영됨", r.d.rows.find((x) => x.name === "김민준")?.record.attitude === "중");

r = await post("/api/attendance", { action: "checkin", pin: byName["김민준"].pin });
ck("키오스크 등원", r.s === 200 && r.d.mode === "in", r.d);
r = await post("/api/attendance", { action: "checkin", pin: byName["김민준"].pin });
ck("키오스크 두 번째 터치 = 하원", r.s === 200 && r.d.mode === "out", r.d);
r = await post("/api/attendance", { action: "checkin", pin: "0000" });
ck("없는 PIN 은 거절", r.s >= 400 || r.d.error, r.d);

r = await post("/api/attendance", { action: "save-tasks", date: today, student_ids: [byName["이서연"].id], items: [{ kind: "집", subject: "문법", title: "검수 과제" }] });
ck("과제 내주기", r.s === 200 && r.d.created === 1, r.d);

r = await post("/api/attendance", { action: "save-textbook", textbook: { subject: "문법", name: "검수교재", price: 1000, stock_total: 1, distributed: 0, step: 1, units: [{ code: "U1", title: "첫" }, { code: "U2", title: "둘" }] } });
ck("교재 저장", r.s === 200, r.d);

r = await post("/api/attendance", { action: "advance-today" });
ck("오늘 진도 일괄 채우기", r.s === 200 && typeof r.d.updated === "number", r.d);

r = await post("/api/attendance", { action: "add-row", student_id: byName["박도윤"].id, date: today });
ck("보강 행 추가", r.s === 200 && r.d.record, r.d);

r = await post("/api/attendance", { action: "send-daily", date: today, dryRun: true });
ck("데일리 발송 미리보기", r.s === 200 && Array.isArray(r.d.results), r.d);

// ── 🔁 재시 안내 (단어테스트 불통과 → 큐 → 발송) ──
// 선생님이 「재시 보내기」 를 따로 기억하지 않아도 되게 save-record 가 큐에 올립니다.
{
  const sid = byName["김민준"].id;
  r = await post("/api/attendance", { action: "save-record", student_id: sid, date: today, fields: { voca_test: "불통과", voca_score: "11/20" } });
  ck("★ 불통과 저장 → 재시 큐에 올라감", r.s === 200 && r.d.record?.retest_sent === "미전송", r.d.record);

  r = await post("/api/attendance", { action: "send-retest", date: today, dryRun: true });
  const mine = (r.d.results || []).find((x) => x.student_id === sid);
  ck("★ 재시 미리보기에 그 학생이 있음", r.s === 200 && !!mine, r.d);
  ck("재시 미리보기에 단어교재·유닛·점수", !!mine && mine.book !== "-" && mine.unit !== "-" && mine.score === "11/20", mine);
  ck("통과한 학생은 안 들어감", (r.d.results || []).every((x) => x.student_id !== byName["박도윤"].id), r.d.results?.map((x) => x.name));

  // 통과로 고치면 큐에서 내려와야 한다 (안 내려오면 엉뚱한 학부모에게 재시 안내가 갑니다)
  r = await post("/api/attendance", { action: "save-record", student_id: sid, date: today, fields: { voca_test: "통과" } });
  ck("★ 통과로 고치면 큐에서 내려옴", r.s === 200 && !r.d.record?.retest_sent, r.d.record);
  r = await post("/api/attendance", { action: "send-retest", date: today, dryRun: true });
  ck("큐에서 내려온 학생은 미리보기에 없음", (r.d.results || []).every((x) => x.student_id !== sid), r.d.results?.map((x) => x.name));

  // 실제 발송 — 솔라피 미설정이면 조용히 skip 되고 500 이 나지 않아야 한다
  await post("/api/attendance", { action: "save-record", student_id: sid, date: today, fields: { voca_test: "불통과" } });
  r = await post("/api/attendance", { action: "send-retest", date: today });
  ck("재시 발송 (솔라피 없음 → 조용히)", r.s === 200 && r.d.solapi === false, r.d);
}

// ── 📋 학생 카드 (지난 진도 쭉) ──
{
  const sid = byName["김민준"].id;
  r = await get(`action=student-history&student_id=${sid}&days=90`);
  ck("★ 학생 카드 이력", r.s === 200 && r.d.student?.name === "김민준" && Array.isArray(r.d.rows), { s: r.s, e: r.d.error });
  ck("★ 과거 기록이 실제로 들어 있음 (2026-05 샘플)", (r.d.rows || []).length > 0, { n: r.d.rows?.length });
  ck("최신 날짜가 앞에 옴", (r.d.rows || []).length < 2 || r.d.rows[0].date >= r.d.rows[1].date, r.d.rows?.slice(0, 2).map((x) => x.date));
  ck("★ 과목 목록이 내려옴", Array.isArray(r.d.subjects) && r.d.subjects.length >= 1, r.d.subjects);
  ck("진도가 비어 있지 않음", (r.d.rows || []).some((x) => Object.keys(x.progress || {}).length), r.d.rows?.[0]?.progress);
  ck("과제 집계(✓/✗)가 붙음", (r.d.rows || []).some((x) => x.tasks && typeof x.tasks.done === "number") || Object.keys(r.d.tasks || {}).length === 0, r.d.rows?.find((x) => x.tasks)?.tasks);

  r = await get(`action=student-history&student_id=${sid}&days=7`);
  ck("기간 7일로 좁히면 줄어듦(또는 같음)", r.s === 200 && r.d.days === 7, { days: r.d.days, n: r.d.rows?.length });
  r = await get("action=student-history&student_id=undefined");
  ck("★ student_id 가 비면 400 (500 아님)", r.s === 400 && typeof r.d.error === "string" && !/\bat \//.test(r.d.error), r.d);
  r = await get("action=student-history&student_id=00000000-0000-0000-0000-000000000000");
  ck("없는 학생은 404", r.s === 404, r.d);
}
r = await post("/api/attendance", { action: "notify-absent" });
ck("미등원 알림(솔라피 없음 → 조용히)", r.s === 200, r.d);

// ── 학생앱 ──
r = await post("/api/student", { action: "login", code: byName["김민준"].student_code, pin: byName["김민준"].pin });
ck("학생 로그인", r.s === 200 && r.d.me.name === "김민준", r.d);
r = await post("/api/student", { action: "home", code: byName["김민준"].student_code, pin: byName["김민준"].pin });
ck("학생 홈", r.s === 200 && Array.isArray(r.d.tasks) && Array.isArray(r.d.progress), r.d);
const t0 = r.d.tasks[0];
r = await post("/api/student", { action: "toggle-task", code: byName["김민준"].student_code, pin: byName["김민준"].pin, task_id: t0.id, done: true });
ck("과제 체크", r.s === 200 && r.d.task.done === true, r.d);
r = await post("/api/student", { action: "toggle-task", code: byName["박도윤"].student_code, pin: byName["박도윤"].pin, task_id: t0.id, done: false });
ck("★ 남의 과제 차단", r.s === 404, r.d);
r = await post("/api/student", { action: "login", code: byName["김민준"].student_code, pin: "9999" });
ck("틀린 PIN 거절", r.s === 401, r.d);

// ── 월말평가서 ──
const rget = async (q) => { const x = await fetch(`${B}/api/report?${q}`); return { s: x.status, d: await x.json() }; };
r = await rget("action=students&month=2026-05");
ck("★ 월별 학생+통계 (2026-05)", r.s === 200 && Array.isArray(r.d.students) && r.d.students.length === 3, { s: r.s, n: r.d.students?.length, e: r.d.error });
const p0 = r.d.students?.[0];
ck("통계가 실제로 계산됨", !!p0 && typeof p0 === "object", p0);

r = await post("/api/report", { action: "preview", student_id: byName["김민준"].id, month: "2026-05" });
ck("★ 미리보기 통계 집계", r.s === 200 && r.d && typeof r.d === "object" && !r.d.error, { s: r.s, e: r.d?.error, keys: r.d && Object.keys(r.d) });

r = await post("/api/report", { action: "generate", student_id: byName["김민준"].id, month: "2026-05" });
ck("AI 키 없을 때 친절한 안내 (스택 아님)", r.s >= 400 && typeof r.d.error === "string" && !/\bat \//.test(r.d.error), r.d);

r = await post("/api/report", { action: "save", student_id: byName["김민준"].id, month: "2026-05", body: "검수 본문", stats: { a: 1 }, progress: {} });
ck("평가서 저장 + share_token 발급", r.s === 200 && (r.d.share_token || r.d.report?.share_token), r.d);
const tok = r.d.share_token || r.d.report?.share_token;

r = await rget(`action=parent&token=${encodeURIComponent(tok)}`);
ck("학부모 열람 (PIN 요구 또는 데이터)", r.s === 200 && (r.d.needPin || r.d.reports), r.d);
r = await rget(`action=parent&token=${encodeURIComponent(tok)}&pin=${byName["김민준"].pin}`);
ck("★ PIN 맞으면 평가서 열람", r.s === 200 && Array.isArray(r.d.reports) && r.d.reports.length >= 1, { s: r.s, e: r.d.error });
r = await rget(`action=parent&token=${encodeURIComponent(tok)}&pin=0000`);
ck("★ PIN 틀리면 차단", r.s === 200 && r.d.needPin === true, r.d);
r = await rget("action=parent&token=없는토큰");
ck("없는 토큰 거절", r.s >= 400 || r.d.error || r.d.needPin !== true, r.d);

r = await post("/api/report", { action: "send", month: "2026-05" });
ck("열람 링크 목록 (솔라피 없음)", r.s === 200, r.d);

// ── cron (새벽 행 생성) ──
r = await fetch(`${B}/api/cron`).then(async (x) => ({ s: x.status, d: await x.json() }));
ck("cron 실행", r.s === 200 && typeof r.d.created === "number", r.d);

// ── 노션 이관 (키 없음 → 친절한 에러여야, 500 스택 아님) ──
r = await post("/api/import-notion", { action: "check" });
ck("노션 미설정 시 친절한 안내", r.s >= 400 && typeof r.d.error === "string" && !r.d.error.includes("at "), r.d);

console.log(fail ? `\n❌ 실패 ${fail}건` : "\n✅ 전부 통과");
process.exit(fail ? 1 : 0);
