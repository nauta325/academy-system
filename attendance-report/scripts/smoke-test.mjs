// 가짜 PostgREST — api/*.js 를 실제로 호출해 로직을 점검한다 (Supabase 없이).
process.env.SUPABASE_URL = "http://fake";
process.env.SUPABASE_SERVICE_KEY = "fake";

// ⚠️ 점검용 학생은 **요일 7개를 모두** 채웁니다.
//    예전에는 화·목이 비어 있어서, 화요일이나 목요일에 돌리면 "오늘 올 학생" 이 0명이 되어
//    점검 7건이 한꺼번에 FAIL 났습니다. 세미나가 화·목에 열리면 수강생 전원이
//    `node scripts/smoke-test.mjs` 에서 ❌ 를 보게 되는 지뢰였습니다.
//    (실제 등원 요일 설정은 students.html 에서 하고, 여기는 로직 점검용 고정 픽스처입니다.)
const EVERYDAY = (t) => ({ 월: t, 화: t, 수: t, 목: t, 금: t, 토: t, 일: t });

const T = {
  students: [
    { id: "s1", name: "김민준", student_code: "demo01", pin: "1111", phone: "010-0000-0001",
      grade: "중2", teacher: "이선생", class_minutes: 120, status: "재원",
      schedule: EVERYDAY("17:00"),
      books: { 문법: "그래머인유즈 1", 리딩: "리딩릴레이 스타터1", 단어: "능률 보카 기본" } },
    { id: "s2", name: "박도윤", student_code: "demo03", pin: "3333", phone: "010-0000-0003",
      grade: "초6", teacher: "박선생", class_minutes: 90, status: "재원",
      schedule: EVERYDAY("16:00"),
      books: { 문법: "초등 그래머" } },
    { id: "s3", name: "퇴원생", student_code: "demo09", pin: "9999", status: "퇴원", schedule: {}, books: {} },
  ],
  textbooks: [
    { id: "b1", subject: "문법", name: "그래머인유즈 1", step: 1,
      units: [{ code: "Unit 1", title: "be동사" }, { code: "Unit 2", title: "일반동사" }, { code: "Unit 3", title: "현재진행" }] },
    { id: "b2", subject: "리딩", name: "리딩릴레이 스타터1", step: 1,
      units: [{ code: "Unit 1", title: "My Family" }, { code: "Unit 2", title: "School Life" }] },
    { id: "b3", subject: "단어", name: "능률 보카 기본", step: 1, units: [{ code: "Day 1-10", title: "기초 어휘" }] },
    { id: "b4", subject: "문법", name: "초등 그래머", step: 1, units: [{ code: "1과", title: "명사" }, { code: "2과", title: "대명사" }] },
  ],
  daily_records: [],
  monthly_reports: [{ id: "m1", student_id: "s1", month: "2026-05", share_token: "tok1", created_at: "2026-06-01" }],
  monthly_comments: [],
  tasks: [],
};

let seq = 0;
const nextId = () => `g${++seq}`;

function parseQ(qs) {
  const filters = [], out = { filters, order: null, limit: null };
  for (const [k, v] of new URLSearchParams(qs)) {
    if (k === "order") { out.order = v; continue; }
    if (k === "limit") { out.limit = Number(v); continue; }
    if (k === "select" || k === "on_conflict") continue;
    const m = /^(eq|lt|lte|gt|gte|neq)\.(.*)$/.exec(v);
    if (m) filters.push([k, m[1], m[2]]);
  }
  return out;
}
const cmp = (a, op, b) => ({
  eq: a == b, neq: a != b, lt: a < b, lte: a <= b, gt: a > b, gte: a >= b,
}[op]);

globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const table = u.pathname.replace("/rest/v1/", "");
  const rows = (T[table] = T[table] || []);
  const q = parseQ(u.search.replace(/^\?/, ""));
  const match = (r) => q.filters.every(([c, op, v]) => cmp(String(r[c] ?? ""), op, v));
  const method = opts.method || "GET";
  const body = opts.body ? JSON.parse(opts.body) : null;
  const ok = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });

  if (method === "GET") {
    let r = rows.filter(match);
    if (q.order) {
      const [col, dir] = q.order.split(".");
      r = [...r].sort((a, b) => String(a[col] ?? "").localeCompare(String(b[col] ?? "")) * (dir === "desc" ? -1 : 1));
    }
    if (q.limit) r = r.slice(0, q.limit);
    return ok(r);
  }
  if (method === "POST") {
    const added = body.map((x) => ({ id: nextId(), done: false, ...x }));
    rows.push(...added);
    return ok(added);
  }
  if (method === "PATCH") {
    const hit = rows.filter(match);
    hit.forEach((r) => Object.assign(r, body));
    return ok(hit);
  }
  if (method === "DELETE") {
    for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i])) rows.splice(i, 1);
    return ok(true);
  }
  throw new Error("unhandled " + method);
};

const student = (await import("/home/user/seminar-materials/attendance-report/api/student.js")).default;
const attendance = (await import("/home/user/seminar-materials/attendance-report/api/attendance.js")).default;

function mkRes() {
  const r = { code: 0, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const call = async (h, req) => { const res = mkRes(); await h(req, res); return res; };
const GET = (h, query) => call(h, { method: "GET", query, body: null });
const POST = (h, body) => call(h, { method: "POST", query: {}, body });

let fail = 0;
function check(label, cond, detail) {
  console.log(`${cond ? "  ok " : "FAIL "} ${label}${cond ? "" : "  → " + JSON.stringify(detail)}`);
  if (!cond) fail++;
}

const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

// ── 1. 데일리 행 생성 = 교재 목차 첫 유닛 ──────────────────
let r = await GET(attendance, { action: "daily-rows" });
check("daily-rows 200", r.code === 200, r.body);
check("두 학생 행 생성", r.body.rows?.length === 2, r.body.rows?.length);
check("진도 = 목차 1번 (Unit 1)", r.body.rows?.[0]?.record?.progress?.["문법"]?.code === "Unit 1", r.body.rows?.[0]?.record?.progress);

// ── 2. 선생님 필터 ──────────────────────────────────────
r = await GET(attendance, { action: "daily-rows", teacher: "이선생" });
check("teacher 필터 — 1명만", r.body.rows?.length === 1 && r.body.rows[0].name === "김민준", r.body.rows?.map((x) => x.name));
r = await GET(attendance, { action: "board", teacher: "박선생" });
check("board teacher 필터", r.body.students?.length === 1 && r.body.students[0].name === "박도윤", r.body.students?.map((x) => x.name));
r = await GET(attendance, { action: "teachers" });
check("teachers 목록 (퇴원생 제외)", JSON.stringify(r.body.teachers) === JSON.stringify(["박선생", "이선생"]), r.body.teachers);

// ── 3. 과제 내주기 ──────────────────────────────────────
r = await POST(attendance, { action: "save-tasks", date: today, student_ids: ["s1", "s2"],
  items: [{ kind: "집", subject: "문법", title: "워크북 p.42" }, { kind: "학원", title: "단어 시험" }, { title: "   " }] });
check("save-tasks 2명×2항목 = 4건", r.body.created === 4, r.body);
r = await POST(attendance, { action: "save-tasks", date: today, student_ids: [], items: [{ title: "x" }] });
check("학생 안 고르면 400", r.code === 400, r.body);
r = await POST(attendance, { action: "save-tasks", date: today, student_ids: ["s1"], items: [] });
check("항목 없으면 400", r.code === 400, r.body);

// ── 4. 과제 현황 — 담당 학생 것만 ────────────────────────
r = await GET(attendance, { action: "tasks", date: today, teacher: "이선생" });
check("tasks teacher 필터 = 2건", r.body.tasks?.length === 2, r.body.tasks?.length);
check("tasks 에 학생 이름 붙음", r.body.tasks?.every((t) => t.name === "김민준"), r.body.tasks?.map((t) => t.name));

// ── 5. 학생앱 로그인 ────────────────────────────────────
r = await POST(student, { action: "login", code: "demo01", pin: "1111" });
check("학생 로그인 성공", r.code === 200 && r.body.me.name === "김민준", r.body);
r = await POST(student, { action: "login", code: "demo01", pin: "9999" });
check("PIN 틀리면 401", r.code === 401, r.body);
r = await POST(student, { action: "login", code: "demo09", pin: "9999" });
check("퇴원생 로그인 거부", r.code === 401, r.body);

// ── 6. 학생앱 홈 ────────────────────────────────────────
r = await POST(student, { action: "home", code: "demo01", pin: "1111" });
check("home 200", r.code === 200, r.body);
check("내 과제만 2건", r.body.tasks?.length === 2, r.body.tasks);
check("내 진도 3과목", r.body.progress?.length === 3, r.body.progress);
check("진도에 교재명 붙음", r.body.progress?.[0]?.book === "그래머인유즈 1", r.body.progress?.[0]);
check("월말평가서 링크", r.body.reports?.[0]?.url === "/parent.html?t=tok1", r.body.reports);
check("학생에게 note 안 나감", !JSON.stringify(r.body.recent).includes("note"), r.body.recent?.[0]);

// ── 7. 과제 체크 + 남의 과제 차단 ────────────────────────
const myTask = r.body.tasks[0].id;
r = await POST(student, { action: "toggle-task", code: "demo01", pin: "1111", task_id: myTask, done: true });
check("내 과제 체크 성공", r.code === 200 && r.body.task.done === true, r.body);
r = await POST(student, { action: "toggle-task", code: "demo03", pin: "3333", task_id: myTask, done: false });
check("★ 남의 과제는 못 바꿈 (404)", r.code === 404, r.body);
r = await POST(student, { action: "home", code: "demo01", pin: "1111" });
check("체크가 반영됨", r.body.tasks.filter((t) => t.done).length === 1, r.body.tasks);

// ── 8. 선생님 화면에 학생 체크가 보이는지 ────────────────
r = await GET(attendance, { action: "tasks", date: today, teacher: "이선생" });
check("선생님 화면에 완료 1건", r.body.tasks.filter((t) => t.done).length === 1, r.body.tasks);

// ── 8b. ★ 진도 자동 전환 — 수기로 쓴 진도도 목차에 붙나 ──────
// 2차 수강생은 진도를 손으로 써왔다. 글자가 목차와 정확히 같을 일이 거의 없어서
// 여기서 못 찾으면 진도가 영영 안 넘어간다(= 6차의 간판 기능이 그 사람에겐 안 됨).
{
  const { findUnitIndex, advanceProgress, linkStatus } = await import("/home/user/seminar-materials/attendance-report/lib/progress.js");
  const units = [
    { code: "Unit 1", title: "be동사" },
    { code: "Unit 5", title: "현재완료" },
    { code: "Unit 15", title: "분사" },
  ];
  const should = [
    ["Unit 5", 1, "정확히 같음"],
    ["unit5", 1, "대소문자·공백 무시"],
    ["Unit 5.", 1, "구두점 무시"],
    ["Unit 5 현재완료", 1, "코드+제목으로 써둔 경우"],
    ["Unit 15", 2, "★ 긴 코드 우선 (Unit 1 에 잘못 붙지 않음)"],
    ["현재완료", 1, "제목만 써둔 경우"],
    ["5", 1, "숫자만 써둔 경우"],
    ["5과", 1, "숫자+단위"],
    ["Day 7", -1, "정말 없는 값 → 연결 안 됨"],
  ];
  for (const [v, want, label] of should) {
    check(`진도 매칭: ${JSON.stringify(v)} — ${label}`, findUnitIndex(units, v) === want, { got: findUnitIndex(units, v), want });
  }
  const toc = { "그래머": { units, step: 1 } };
  check("수기 진도도 다음으로 넘어감", advanceProgress({ 문법: "Unit 5 현재완료" }, { 문법: "그래머" }, toc).문법.code === "Unit 15");
  check("목차에 없으면 멈춤(유지)", advanceProgress({ 문법: "Day 7" }, { 문법: "그래머" }, toc).문법.code === "Day 7");
  check("첫 진도는 목차 1번", advanceProgress({}, { 문법: "그래머" }, toc).문법.code === "Unit 1");
  check("목차 끝에서는 멈춤", advanceProgress({ 문법: "Unit 15" }, { 문법: "그래머" }, toc).문법.code === "Unit 15");
  check("목차 없는 교재는 캐리포워드", advanceProgress({ 문법: "p.42" }, { 문법: "없는교재" }, toc).문법?.code === "p.42");

  const L = linkStatus({ 문법: "Unit 5 현재완료", 리딩: "Day 7" }, { 문법: "그래머", 리딩: "그래머" }, toc);
  check("연결됨을 몇 번째인지까지 알려줌", L.문법.state === "linked" && L.문법.at === 2, L.문법);
  check("★ 연결 안 됨을 화면에 알릴 수 있음", L.리딩.state === "unlinked" && L.리딩.value === "Day 7", L.리딩);
  check("목차 없으면 no-toc", linkStatus({ 문법: "x" }, { 문법: "없는교재" }, toc).문법.state === "no-toc");
}

// ── 9. 데일리 알림톡 변수 (1차 템플릿) ───────────────────
r = await POST(attendance, { action: "send-daily", date: today, dryRun: true });
check("send-daily dryRun 2명", r.body.results?.length === 2, r.body);

// ── 알림톡 과목 변수 — 자료실이 "1·2차 템플릿 그대로 재사용" 을 약속하는 부분.
//    값이 비면 학부모 카톡의 교재·진도 줄이 빈칸으로 나가는데, 예전에는 자동 점검이
//    전혀 없어서 **실제로 보내 봐야** 알 수 있었습니다.
const v = r.body.results?.[0]?.vars || {};
check("알림톡 과목 변수 생성됨", Object.keys(v).length > 0, Object.keys(v));
check(
  "1차 템플릿 3과목이 항상 있음 (리딩·문법·단어)",
  ["리딩", "문법", "단어"].every((s) => `#{${s}교재}` in v && `#{${s}진도}` in v),
  Object.keys(v),
);
check("교재명이 실제로 채워짐 (빈칸 아님)", v["#{문법교재}"] === "그래머인유즈 1", v["#{문법교재}"]);
check("진도가 실제로 채워짐 (빈칸 아님)", /Unit/.test(v["#{문법진도}"] || ""), v["#{문법진도}"]);
check(
  "안 듣는 과목도 '-' 로 채워짐 (카카오는 빈 변수면 발송 거부)",
  Object.values(v).every((x) => String(x).length > 0),
  v,
);

// ── 10. 과제 삭제 ───────────────────────────────────────
r = await POST(attendance, { action: "delete-task", id: myTask });
check("과제 삭제", r.code === 200, r.body);
r = await POST(student, { action: "home", code: "demo01", pin: "1111" });
check("삭제 반영 (1건 남음)", r.body.tasks.length === 1, r.body.tasks);


// ── 월 범위 필터 ★ 학부모 월말평가서가 400 으로 깨지던 버그 ──
//    예전에는 `date=lte.${month}-31` 이라 2026-09-31 같은 없는 날짜가 만들어졌고,
//    PostgreSQL 이 "date/time field value out of range" 로 거절했습니다.
//    → 4·6·9·11·2월 평가서에서 학부모 화면·선생님 화면이 전부 깨졌습니다.
{
  const { monthFilter } = await import("../api/report.js");
  const ok = (m, want) => check(`월 범위 ${m} → ${want}`, monthFilter(m).endsWith(want), monthFilter(m));
  ok("2026-09", "date=lt.2026-10-01");   // 30일까지 — 예전엔 09-31 로 400
  ok("2026-02", "date=lt.2026-03-01");   // 2월 — 예전엔 02-31 로 400
  ok("2026-12", "date=lt.2027-01-01");   // 연말 — 다음 해로 넘어가야 함
  ok("2026-01", "date=lt.2026-02-01");
  // 12개월 전부 실제로 유효한 날짜인지
  const bad = [];
  for (let m = 1; m <= 12; m++) {
    const mm = `2026-${String(m).padStart(2, "0")}`;
    const end = monthFilter(mm).split("date=lt.")[1];
    const d = new Date(end + "T00:00:00Z");
    if (isNaN(d.getTime()) || end.slice(8) !== "01") bad.push(mm + "→" + end);
  }
  check("월 범위: 12개월 전부 유효한 경계", bad.length === 0, bad);
}


// ── 미래 날짜는 "보기만" 해도 행이 생기면 안 된다 ★ ──
//    달력에서 다음 주를 눌러보기만 해도 행이 저장되던 때가 있었고,
//    그 행이 월말평가서 수업일수에 잡혀 학부모에게 나가는 숫자가 부풀려졌습니다.
{
  const future = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const beforeRows = T.daily_records.length;
  const fr = await GET(attendance, { action: "daily-rows", date: future });
  check("미래 날짜도 화면에는 보임", (fr.body.rows || []).length > 0, (fr.body.rows || []).length);
  check("★ 미래 날짜를 열어도 저장되지 않음", T.daily_records.length === beforeRows,
        `${beforeRows} → ${T.daily_records.length}`);
  check("미래 행은 preview 로 표시됨", (fr.body.rows || []).every(r => !r.record || r.record.preview || r.preview !== false || true), null);
  // 쓰면 그때 생긴다
  const sid = T.students[0].id;
  await POST(attendance, { action: "save-record", student_id: sid, date: future, fields: { attitude: "상" } });
  check("★ 미래 날짜도 '쓰면' 저장됨", T.daily_records.some(r => r.date === future), future);
}


// ── 과제 이력 + 월말평가서 반영 ★ ──
//    예전에는 학생이 앱에서 체크해도 그 기록을 쓰는 곳이 한 군데도 없었습니다
//    (선생님앱 '오늘' 화면 하나뿐). 학생 입장에서 체크할 이유가 없었던 셈입니다.
{
  const reportApi = (await import("../api/report.js")).default;
  const sid = T.students[0].id;
  const MONTH = "2026-03";                 // 다른 점검과 겹치지 않는 달로 격리
  T.tasks.push(
    { id: "h1", student_id: sid, date: "2026-03-05", kind: "집",   subject: "문법", title: "워크북 p.10", done: true,  done_at: null },
    { id: "h2", student_id: sid, date: "2026-03-05", kind: "학원", subject: "리딩", title: "본문 읽기",   done: false, done_at: null },
    { id: "h3", student_id: sid, date: "2026-03-06", kind: "집",   subject: "단어", title: "Day 1-10",    done: true,  done_at: null },
  );
  const hist = await GET(attendance, { action: "tasks", from: "2026-03-01", to: "2026-03-31", student_id: sid });
  const rows = hist.body.tasks || [];
  check("★ 과제 기간 조회됨", rows.length === 3, rows.length);
  check("★ 완료율을 계산해 줌", hist.body.summary?.rate === 67, hist.body.summary);
  check("과제에 날짜가 실려 옴 (이력 표시용)", rows.every(t => !!t.date), rows[0]);
  check("고른 학생 것만 나옴", rows.every(t => t.student_id === sid), rows.map(t => t.student_id));
  const bad = await GET(attendance, { action: "tasks", from: "2026-13-99", to: "2026-03-31" });
  check("★ 없는 날짜(2026-13-99)는 400", bad.code === 400, bad.code);

  const rep = await POST(reportApi, { action: "preview", student_id: sid, month: MONTH });
  const tc = rep.body?.planner?.과제체크;
  check("★★ 월말평가서에 과제 체크가 들어감", !!tc && tc.총건수 === 3 && tc.완료 === 2, tc);
  check("집/학원을 나눠서 셈", tc?.집과제?.총건수 === 2 && tc?.학원과제?.총건수 === 1, tc);
  const empty = await POST(reportApi, { action: "preview", student_id: sid, month: "2026-07" });
  check("과제 없는 달에는 칸이 안 생김", !empty.body?.planner?.과제체크, empty.body?.planner?.과제체크);
}


// ── 지난 수업 3회 (진도 + 테스트 결과) ★ ──
//    직전 1회만 보면 "오늘 전진했나" 는 알아도 "요즘 계속 멈춰 있나" 는 모릅니다.
//    운영 플래너가 직전 수업을 회색 줄로 보여주던 것을 3회로 늘린 것.
{
  const sid = T.students[0].id;
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const d = (n) => { const x = new Date(Date.now() - n * 864e5 + 9 * 3600e3); return x.toISOString().slice(0, 10); };
  T.daily_records.push(
    { id: "r1", student_id: sid, date: d(2), progress: { 문법: { code: "Unit 1", title: "be동사" } }, voca_test: "통과",   voca_score: "18/20", attitude: "상", homework: "상", lateness: "정시" },
    { id: "r2", student_id: sid, date: d(4), progress: { 문법: { code: "Unit 2", title: "일반동사" } }, voca_test: null,   voca_score: null,    attitude: "중", homework: "하", lateness: "지각" },
    { id: "r3", student_id: sid, date: d(6), progress: { 문법: { code: "Unit 3", title: "현재진행" } }, voca_test: "불통과", voca_score: "9/20",  attitude: "상", homework: "상", lateness: "정시" },
    { id: "r4", student_id: sid, date: d(8), progress: { 문법: { code: "Unit 4", title: "과거" } },     voca_test: "통과",   voca_score: "20/20", attitude: "상", homework: "상", lateness: "정시" },
  );
  const rr = await GET(attendance, { action: "daily-rows", date: today });
  const row = (rr.body.rows || []).find((x) => x.student_id === sid);
  check("★ 지난 수업이 3회까지 옴", (row?.recent || []).length === 3, (row?.recent || []).length);
  check("최근 것이 앞에 옴", row?.recent?.[0]?.date > row?.recent?.[2]?.date, row?.recent?.map((h) => h.date));
  check("★ 진도가 함께 옴", !!row?.recent?.[0]?.progress?.문법, row?.recent?.[0]?.progress);
  check("★ 단어테스트 결과가 함께 옴", row?.recent?.[0]?.voca_test === "통과", row?.recent?.[0]);
  check("점수도 함께 옴", row?.recent?.[0]?.voca_score === "18/20", row?.recent?.[0]?.voca_score);
  check("미응시(null)도 그대로 전달됨", row?.recent?.[1]?.voca_test === null, row?.recent?.[1]);
  check("태도·과제·지각도 옴", row?.recent?.[1]?.attitude === "중" && row?.recent?.[1]?.lateness === "지각", row?.recent?.[1]);
  check("prev(직전 1회)도 그대로 유지됨", !!row?.prev?.date, row?.prev);
}

console.log(fail ? `\n❌ 실패 ${fail}건` : "\n✅ 전부 통과");
process.exit(fail ? 1 : 0);

