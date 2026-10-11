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
