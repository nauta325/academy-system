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

console.log(fail ? `\n❌ 실패 ${fail}건` : "\n✅ 전부 통과");
process.exit(fail ? 1 : 0);
