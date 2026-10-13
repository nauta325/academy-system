// 출결 API (Vercel serverless) — 학생관리 · PIN 등하원 · 현황판 · 데일리 리포트.
// 실사용 시스템의 3기능 중 ①데일리 리포트(작성·보내기) ②출석 현황판 을 이 파일 하나로.
// (③월말평가서는 api/report.js)
//
// 액션:
//   GET  ?action=students                    → 학생 전체 (students.html)
//   GET  ?action=textbooks                   → 교재·목차 전체 (books.html)
//   GET  ?action=board&date=YYYY-MM-DD        → 출석 현황판 (board.html, 기본 오늘)
//   GET  ?action=daily-rows&date=YYYY-MM-DD   → 데일리 리포트 작성용 행 + 직전 진도 (daily.html)
//   POST {action:"send-daily", date, dryRun, student_ids} → 데일리 리포트 학부모 카톡 발송
//   POST {action:"save-student", student}     → 학생 추가/수정
//   POST {action:"delete-student", id}        → 학생 삭제
//   POST {action:"bulk-students", rows:[...]} → 붙여넣기 일괄 등록
//   POST {action:"checkin", pin}              → PIN 등원/하원 토글 (키오스크)
//   POST {action:"checkout", student_id}      → 하원 처리 (현황판, 카톡 안 보냄)
//   POST {action:"save-record", student_id, date, fields} → 데일리 리포트 한 줄 저장
//   POST {action:"advance-today"}             → 오늘 진도를 목차 다음으로 일괄 채우기
//   POST {action:"notify-absent"}             → 미등원 학부모 알림톡 (수동)
//   POST {action:"save-textbook"|"delete-textbook"} → 교재·목차 관리
//   GET  ?action=teachers                     → 담당 선생님 목록 (선생님앱 teacher.html)
//   GET  ?action=tasks&date=...                → 그날 과제 현황 (선생님앱)
//   POST {action:"save-tasks", date, student_ids, items} → 과제 내주기 (여러 학생 × 여러 항목)
//   POST {action:"delete-task", id}            → 과제 1건 삭제
//
// ※ students · board · daily-rows · tasks 는 `&teacher=이선생` 을 붙이면 그 선생님 담당 학생만.
//    선생님앱(teacher.html)이 이 필터를 쓴다. 안 붙이면 전체(원장님 화면과 동일).

import { select, insert, patch, remove, dbConfigured } from "../lib/db.js";
import { kstNow, toMinutes, addMinutes } from "../lib/time.js";
import { sendAlimtalk, TPL } from "../lib/solapi.js";
import { tocByBook, advanceProgress, normUnit, linkStatus } from "../lib/progress.js";

const GRACE = 10;       // 지각 유예(분)
const LEAVE_SOON = 15;  // "곧 하원" 판단(예상 하원시간 15분 전부터)
const SUBJECTS = ["문법", "리딩", "단어"];

// 유닛 {code,title} → "코드 제목" 라벨
function unitLabel(u) {
  const n = normUnit(u);
  if (!n) return "";
  return [n.code, n.title].filter(Boolean).join(" ");
}
// 진도 jsonb → 한 줄 문자열 (데일리 리포트 카톡·미리보기용)
function progressText(progress) {
  const p = progress || {};
  return SUBJECTS.filter((s) => p[s]).map((s) => `${s} ${unitLabel(p[s])}`).join(" · ");
}

// 단어테스트 표기 (결과 + 점수)
function vocaText(rec) {
  if (!rec?.voca_test) return "";
  return rec.voca_score ? `${rec.voca_test} (${rec.voca_score})` : rec.voca_test;
}

// 오늘 행 없으면 만들어 반환 (진도는 교재 목차의 다음 유닛으로 자동 전환)
// 학생 한 명의 그날 데일리리포트 행을 찾고, 없으면 다음 진도로 만들어 돌려준다.
//
// ⚠️ studentId/date 가 비어 있으면 `student_id=eq.undefined` 같은 질의가 나가서
//    PostgREST 가 400 을 주고, 그게 500 으로 올라가 화면에 내부 에러가 그대로 뜹니다.
//    (화면에서는 늘 채워 보내지만, 저장 중 행이 아직 없거나 통신이 꼬이면 생길 수 있음)
//    여기서 한 번 막으면 이 함수를 쓰는 네 곳이 전부 보호됩니다.
// 막으려는 건 `undefined`·빈값이 그대로 질의에 실려 나가는 것입니다.
// id 형식(uuid)을 강제하지는 않습니다 — 형식을 박아두면 점검용 데이터나
// 나중에 id 체계를 바꿀 때 멀쩡한 호출까지 막히기 때문입니다.
const BAD_ID = /^(undefined|null|NaN|)$/i;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;         // 필터에 그대로 들어가므로 이상한 문자는 거른다
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
class BadRequest extends Error {
  constructor(msg) { super(msg); this.status = 400; }
}
async function ensureTodayRow(studentId, date) {
  const sid = String(studentId ?? "").trim();
  if (BAD_ID.test(sid) || !SAFE_ID.test(sid)) {
    throw new BadRequest("학생을 찾을 수 없어요. 화면을 새로고침한 뒤 다시 해주세요.");
  }
  if (!date || !DATE_RE.test(String(date)) || isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
    throw new BadRequest(`날짜가 올바르지 않아요: ${date}`);
  }
  const rows = await select(
    "daily_records",
    `student_id=eq.${studentId}&date=eq.${date}`
  );
  if (rows[0]) return rows[0];
  const [prev, students, toc] = await Promise.all([
    select("daily_records", `student_id=eq.${studentId}&date=lt.${date}&order=date.desc&limit=1&select=progress`),
    select("students", `id=eq.${studentId}&select=books`),
    tocByBook(),
  ]);
  const bk = students[0]?.books || {};
  const created = await insert("daily_records", {
    student_id: studentId,
    date,
    progress: advanceProgress(prev[0]?.progress, bk, toc),
    books: bk, // 그날 교재 스냅샷 (교재 전환 감지용)
  });
  return created[0];
}

// 담당 선생님 필터 — 선생님앱에서 `?teacher=이선생` 으로 쓴다. 없으면 빈 문자열(전체).
function teacherFilter(req) {
  const t = String((req.method === "GET" ? req.query.teacher : req.body?.teacher) || "").trim();
  return t ? `&teacher=eq.${encodeURIComponent(t)}` : "";
}

function lateness(scheduled, actual) {
  const s = toMinutes(scheduled);
  const a = toMinutes(actual);
  if (s === null || a === null) return "정시"; // 예정시간 없으면 정시 처리
  return a > s + GRACE ? "지각" : "정시";
}

export default async function handler(req, res) {
  if (!dbConfigured()) {
    return res.status(500).json({ error: "SUPABASE_URL / SUPABASE_SERVICE_KEY 환경변수가 없어요." });
  }
  try {
    const action = req.method === "GET" ? req.query.action : (req.body?.action ?? "");
    const now = kstNow();

    // ── 학생 목록 ──
    if (action === "students") {
      const students = await select("students", `order=name.asc${teacherFilter(req)}`);
      return res.status(200).json({ students });
    }

    // ── 교재(목차) 목록 ──
    if (action === "textbooks") {
      const textbooks = await select("textbooks", "order=subject.asc,name.asc");
      return res.status(200).json({ textbooks });
    }

    // ── 현황판 ──
    if (action === "board") {
      const date = req.query.date || now.date;
      const weekday = date === now.date ? now.weekday : "일월화수목금토"[new Date(date + "T00:00:00Z").getUTCDay()];
      const students = await select("students", `status=eq.재원&order=name.asc${teacherFilter(req)}`);
      const records = await select("daily_records", `date=eq.${date}`);
      const recBy = Object.fromEntries(records.map((r) => [r.student_id, r]));

      const isToday = date === now.date;
      const nowMin = toMinutes(now.hhmm);
      const list = [];
      for (const s of students) {
        const scheduled = (s.schedule || {})[weekday] || "";
        const rec = recBy[s.id];
        if (!scheduled && !rec) continue; // 오늘 수업 없고 기록도 없으면 숨김
        const expectedEnd = rec?.check_in
          ? addMinutes(rec.check_in, s.class_minutes)
          : addMinutes(scheduled, s.class_minutes);
        // 실사용 현황판과 동일한 상태 구분
        let status;
        if (rec?.check_out) status = "하원";
        else if (rec?.lateness === "결석") status = "결석";
        else if (rec?.check_in) {
          const endMin = toMinutes(expectedEnd);
          status = isToday && endMin !== null && nowMin >= endMin - LEAVE_SOON ? "곧 하원" : "수업중";
        } else {
          // 아직 등원 전 — 예정시간+유예 지났으면 '지각 미등원', 아니면 '미등원'
          const overdue = scheduled && isToday && nowMin > toMinutes(scheduled) + GRACE;
          status = overdue ? "지각 미등원" : "미등원";
        }
        list.push({
          student_id: s.id,
          name: s.name,
          grade: s.grade,
          teacher: s.teacher,
          class_minutes: s.class_minutes,
          scheduled,
          expected_end: expectedEnd,
          status,
          record: rec
            ? {
                check_in: rec.check_in, check_out: rec.check_out, lateness: rec.lateness,
                attitude: rec.attitude, homework: rec.homework, voca_test: rec.voca_test,
                progress: rec.progress, note: rec.note,
              }
            : null,
          books: s.books || {},
        });
      }
      const count = (st) => list.filter((x) => x.status === st).length;
      const stats = {
        오늘예정: list.length,
        수업중: count("수업중"),
        미등원: count("미등원"),
        지각미등원: count("지각 미등원"),
        곧하원: count("곧 하원"),
        결석: count("결석"),
        하원완료: count("하원"),
      };
      return res.status(200).json({ date, weekday, students: list, stats });
    }

    // ── 데일리 리포트 작성용: 그날 학생별 행 + 직전 진도 ──────────
    // 오늘 등원을 판단해 행이 없으면 다음 진도를 적용해 새로 만든다.
    if (action === "daily-rows") {
      const date = req.query.date || now.date;
      const weekday = date === now.date ? now.weekday : "일월화수목금토"[new Date(date + "T00:00:00Z").getUTCDay()];
      const students = await select("students", `status=eq.재원&order=name.asc${teacherFilter(req)}`);
      let records = await select("daily_records", `date=eq.${date}`);
      let recBy = Object.fromEntries(records.map((r) => [r.student_id, r]));
      const toc = await tocByBook();

      // 그날 수업 예정인데 행이 없는 학생 → 직전 진도의 '다음 목차'로 채워 보여준다.
      //
      // ⚠️ **앞으로 올 날짜는 보여주기만 하고 저장하지 않습니다.**
      //    예전에는 달력에서 다음 주를 한 번 눌러보기만 해도 그 날짜 행이 DB에 만들어졌고,
      //    그 행이 **월말평가서의 수업일수에 그대로 잡혔습니다**
      //    (실제로 1일 수업했는데 미리 눌러본 3일이 더해져 4일로 집계).
      //    학부모에게 나가는 숫자라 그냥 두면 안 됩니다.
      //    → 미래 날짜는 미리보기(가짜 id 없이)만, 저장은 선생님이 실제로 쓸 때
      //      save-record 가 만들어 줍니다. 오늘·지난 날짜는 종전대로 생성합니다.
      const isFuture = date > now.date;
      const missing = students.filter((s) => (s.schedule || {})[weekday] && !recBy[s.id]);
      if (missing.length) {
        const toCreate = [];
        for (const s of missing) {
          const prev = await select(
            "daily_records",
            `student_id=eq.${s.id}&date=lt.${date}&order=date.desc&limit=1&select=progress`
          );
          toCreate.push({ student_id: s.id, date, progress: advanceProgress(prev[0]?.progress, s.books, toc), books: s.books || {} });
        }
        // 미래면 저장하지 않고 화면에만 (preview: true 로 표시)
        const created = isFuture
          ? toCreate.map((r) => ({ ...r, preview: true }))
          : await insert("daily_records", toCreate);
        records = records.concat(created);
        recBy = Object.fromEntries(records.map((r) => [r.student_id, r]));
      }

      // 각 행에 직전 수업 진도(비교용)를 붙인다
      const rows = [];
      for (const s of students) {
        const rec = recBy[s.id];
        if (!rec) continue; // 오늘 수업 없고 행도 없으면 데일리 리포트 대상 아님
        const prev = await select(
          "daily_records",
          `student_id=eq.${s.id}&date=lt.${date}&order=date.desc&limit=1&select=date,progress`
        );
        rows.push({
          record_id: rec.id,
          student_id: s.id,
          name: s.name,
          grade: s.grade,
          teacher: s.teacher,
          phone: s.phone,
          scheduled: (s.schedule || {})[weekday] || "",
          books: s.books || {},
          record: {
            check_in: rec.check_in, check_out: rec.check_out, lateness: rec.lateness,
            attitude: rec.attitude, homework: rec.homework,
            voca_test: rec.voca_test, voca_score: rec.voca_score,
            progress: rec.progress || {}, note: rec.note, parent_note: rec.parent_note,
            report_sent: rec.report_sent,
          },
          prev: prev[0] ? { date: prev[0].date, progress: prev[0].progress || {} } : null,
          // 진도가 교재 목차와 연결됐는지 — 화면에서 "왜 안 넘어가지?" 를 바로 보여주려고.
          link: linkStatus(rec.progress, s.books, toc),
        });
      }
      return res.status(200).json({ date, weekday, rows });
    }

    // ── 보강/누락: 특정 학생의 그날 행을 수동 생성 (정규 수업일이 아니어도) ──
    if (action === "add-row") {
      const { student_id, date } = req.body;
      if (!student_id) return res.status(400).json({ error: "student_id 필요" });
      const row = await ensureTodayRow(student_id, date || now.date); // 없으면 다음 진도로 생성
      return res.status(200).json({ record: row });
    }

    // ── 데일리 리포트 학부모 카톡 발송 (미리보기 dryRun / 실제 발송) ──
    // body: { date, dryRun?, student_ids?[] }  student_ids 없으면 그날 기록 전체
    if (action === "send-daily") {
      const date = req.body.date || now.date;
      const only = Array.isArray(req.body.student_ids) ? new Set(req.body.student_ids) : null;
      const dryRun = Boolean(req.body.dryRun);

      const students = await select("students", `status=eq.재원${teacherFilter(req)}`);
      const stuBy = Object.fromEntries(students.map((s) => [s.id, s]));
      let records = await select("daily_records", `date=eq.${date}`);
      records = records.filter((r) => (only ? only.has(r.student_id) : true) && r.lateness !== "결석");

      const results = [];
      let sent = 0;
      for (const r of records) {
        const stu = stuBy[r.student_id];
        if (!stu) continue;
        const phone = String(stu.phone || "").replace(/[^0-9]/g, "");
        const preview = {
          student_id: stu.id,
          name: stu.name,
          phone: stu.phone || "",
          progress: progressText(r.progress),
          attitude: r.attitude || "-",
          homework: r.homework || "-",
          voca: vocaText(r) || "-",
          parent_note: r.parent_note || "",
          already: r.report_sent === "전송",
        };
        if (phone.length < 10) { results.push({ ...preview, ok: false, reason: "연락처 없음" }); continue; }

        // 알림톡 변수 — 1차(노션 알림톡) 세미나 템플릿을 그대로 쓰실 수 있게 과목별 교재·진도도 함께 보낸다.
        // 과목명은 고정하지 않고 books/progress(jsonb)에 실제로 들어 있는 키를 쓴다.
        // → 영어(문법·리딩·단어)든 수학(연산·교과)이든 과목 키만 바꾸면 템플릿이 그대로 동작.
        // 솔라피는 템플릿에 없는 변수는 무시하므로, 어떤 템플릿을 쓰시든 안전하다.
        //
        // ★ 미리보기(dryRun)에서도 이 변수를 만들어 돌려줍니다.
        //   예전에는 dryRun 이 여기 위에서 빠져나가서, 교재·진도가 제대로 채워지는지
        //   **실제로 학부모에게 보내 봐야** 알 수 있었습니다. 제일 나쁜 곳에서 알게 되는 구조라
        //   미리보기 단계에서 값을 볼 수 있게 바꿨습니다.
        const rBooks = r.books || {}, sBooks = stu.books || {}, rProg = r.progress || {};
        // 1차 템플릿이 쓰는 3과목은 학생이 안 듣더라도 변수를 비워두지 않는다.
        // (카카오는 치환 안 된 변수가 있으면 발송을 거부한다 — 그래서 없으면 "-")
        const subjects = [...new Set([
          "리딩", "문법", "단어",
          ...Object.keys(sBooks), ...Object.keys(rBooks), ...Object.keys(rProg),
        ])];
        const subjVars = {};
        for (const s of subjects) {
          const p = rProg[s] || {};
          const unit = typeof p === "string" ? p : (p.code || p.유닛코드 || "");
          subjVars[`#{${s}교재}`] = String(rBooks[s] || sBooks[s] || "-");
          subjVars[`#{${s}진도}`] = String(unit || "-");
        }
        // 미리보기면 "무엇이 나갈지" 를 돌려주고 끝. (발송하지 않음)
        if (dryRun) { results.push({ ...preview, vars: subjVars, ok: true }); continue; }

        const send = await sendAlimtalk(stu.phone, TPL.daily, {
          "#{학생이름}": stu.name,
          "#{날짜}": date,
          "#{진도}": preview.progress || "-",
          "#{태도}": preview.attitude,
          "#{과제}": preview.homework,
          "#{지각}": r.lateness || "정시",
          "#{단어테스트}": preview.voca,
          "#{추가사항}": preview.parent_note || "-",
          ...subjVars,
        });
        if (send.success) {
          await patch("daily_records", `id=eq.${r.id}`, { report_sent: "전송" });
          sent++;
          results.push({ ...preview, ok: true });
        } else {
          results.push({ ...preview, ok: false, reason: send.reason || (send.skipped ? "솔라피 미설정" : "발송 실패") });
        }
      }
      return res.status(200).json({ date, total: results.length, sent, dryRun, results, solapi: Boolean(TPL.daily) });
    }

    // ── 학생 저장(추가/수정) ──
    if (action === "save-student") {
      const s = req.body.student || {};
      if (!s.name) return res.status(400).json({ error: "이름은 필수예요." });
      const row = {
        name: s.name, student_code: s.student_code || null,
        pin: s.pin || null, phone: s.phone || null,
        grade: s.grade || null, teacher: s.teacher || null,
        class_minutes: Number(s.class_minutes) || 120,
        status: s.status || "재원",
        schedule: s.schedule || {}, books: s.books || {},
      };
      let saved;
      if (s.id) saved = (await patch("students", `id=eq.${s.id}`, row))[0];
      else saved = (await insert("students", row))[0];
      return res.status(200).json({ student: saved });
    }

    // ── 학생 삭제 ──
    if (action === "delete-student") {
      if (!req.body.id) return res.status(400).json({ error: "id 필요" });
      await remove("students", `id=eq.${req.body.id}`);
      return res.status(200).json({ ok: true });
    }

    // ── 붙여넣기 일괄 등록 (name, pin, phone, grade 순 탭 구분) ──
    if (action === "bulk-students") {
      const rows = (req.body.rows || [])
        .filter((r) => r.name)
        .map((r) => ({
          name: r.name, student_code: r.student_code || null,
          pin: r.pin || null, phone: r.phone || null,
          grade: r.grade || null, teacher: r.teacher || null,
          class_minutes: Number(r.class_minutes) || 120,
          schedule: r.schedule || {}, books: r.books || {},
        }));
      if (!rows.length) return res.status(400).json({ error: "등록할 학생이 없어요." });
      const saved = await insert("students", rows);
      return res.status(200).json({ count: saved.length });
    }

    // ── 키오스크: PIN 등원/하원 토글 ──
    if (action === "checkin") {
      const pin = String(req.body.pin || "").trim();
      if (!pin) return res.status(400).json({ error: "PIN을 입력하세요." });
      const found = await select("students", `pin=eq.${pin}&status=eq.재원`);
      const student = found[0];
      if (!student) return res.status(404).json({ error: "PIN을 찾을 수 없어요." });

      const row = await ensureTodayRow(student.id, now.date);
      if (row.check_in && !row.check_out) {
        // 이미 등원 → 하원 처리
        const upd = (await patch("daily_records", `id=eq.${row.id}`, { check_out: now.hhmm }))[0];
        // 학부모 하원 알림톡 (미설정이면 조용히 skip) — 키오스크 하원에서만 발송.
        // 현황판 하원(action=checkout)은 실사용과 동일하게 카톡을 보내지 않는다.
        await sendAlimtalk(student.phone, TPL.checkout, {
          "#{학생이름}": student.name, "#{하원시간}": upd.check_out,
        });
        return res.status(200).json({ mode: "out", name: student.name, grade: student.grade, time: upd.check_out, check_in: row.check_in });
      }
      if (row.check_out) {
        return res.status(200).json({ mode: "done", name: student.name, grade: student.grade, time: row.check_out });
      }
      // 등원 처리
      const scheduled = (student.schedule || {})[now.weekday] || "";
      const late = lateness(scheduled, now.hhmm);
      const expectedEnd = addMinutes(now.hhmm, student.class_minutes);
      const upd = (await patch("daily_records", `id=eq.${row.id}`, {
        check_in: now.hhmm, lateness: late,
      }))[0];
      // 학부모 등원 알림톡 (미설정이면 조용히 skip)
      const sent = await sendAlimtalk(student.phone, TPL.checkin, {
        "#{학생이름}": student.name, "#{등원시간}": now.hhmm, "#{하원시간}": expectedEnd,
      });
      await patch("daily_records", `id=eq.${row.id}`, {
        kakao_sent: sent.success ? "전송" : sent.skipped ? "미전송" : "실패",
      });
      return res.status(200).json({
        mode: "in", name: student.name, grade: student.grade, time: upd.check_in,
        lateness: late, expected_end: expectedEnd,
      });
    }

    // ── 현황판: 하원 처리 (실사용 현황판과 동일 — 카톡 안 보내고 시간만 기록) ──
    if (action === "checkout") {
      const { student_id } = req.body;
      const row = await ensureTodayRow(student_id, now.date);
      const upd = (await patch("daily_records", `id=eq.${row.id}`, {
        check_out: now.hhmm,
        check_in: row.check_in || now.hhmm,
        lateness: row.lateness || "정시",
      }))[0];
      return res.status(200).json({ record: upd });
    }

    // ── 미등원 학부모 알림톡 (현황판 버튼에서 호출) ──
    if (action === "notify-absent") {
      const students = await select("students", "status=eq.재원");
      const records = await select("daily_records", `date=eq.${now.date}`);
      const recBy = Object.fromEntries(records.map((r) => [r.student_id, r]));
      let sent = 0;
      for (const s of students) {
        const scheduled = (s.schedule || {})[now.weekday] || "";
        if (!scheduled) continue;
        if (toMinutes(now.hhmm) <= toMinutes(scheduled) + GRACE) continue; // 아직 유예 안 지남
        const rec = recBy[s.id];
        if (rec?.check_in) continue; // 이미 등원
        const r = await sendAlimtalk(s.phone, TPL.late, {
          "#{학생이름}": s.name, "#{예정시간}": scheduled,
        });
        if (r.success) sent++;
      }
      return res.status(200).json({ sent });
    }

    // ── 오늘 한 줄 기록 저장 (진도·태도·과제·단어테스트·메모) ──
    if (action === "save-record") {
      const { student_id, date, fields } = req.body;
      const d = date || now.date;
      const row = await ensureTodayRow(student_id, d);
      const allow = ["attitude", "homework", "voca_test", "voca_score", "progress",
                     "note", "parent_note", "lateness", "check_out"];
      const body = {};
      for (const k of allow) if (k in (fields || {})) body[k] = fields[k];
      const upd = (await patch("daily_records", `id=eq.${row.id}`, body))[0];
      return res.status(200).json({ record: upd });
    }

    // ── 교재(목차) 저장/삭제 ──
    if (action === "save-textbook") {
      const t = req.body.textbook || {};
      if (!t.name) return res.status(400).json({ error: "교재명은 필수예요." });
      const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));
      const row = {
        subject: t.subject || null,
        name: t.name,
        price: num(t.price),
        stock_total: num(t.stock_total),
        distributed: num(t.distributed) ?? 0,
        units: Array.isArray(t.units) ? t.units : [],
        step: Number(t.step) > 0 ? Number(t.step) : 1,
      };
      const saved = t.id
        ? (await patch("textbooks", `id=eq.${t.id}`, row))[0]
        : (await insert("textbooks", row))[0];
      return res.status(200).json({ textbook: saved });
    }
    if (action === "delete-textbook") {
      if (!req.body.id) return res.status(400).json({ error: "id 필요" });
      await remove("textbooks", `id=eq.${req.body.id}`);
      return res.status(200).json({ ok: true });
    }

    // ── 오늘 진도 자동 채우기 (목차의 다음 유닛으로) ──
    if (action === "advance-today") {
      const today = now.date;
      const students = await select("students", "status=eq.재원");
      const toc = await tocByBook();
      let updated = 0;
      for (const s of students) {
        const rows = await select("daily_records", `student_id=eq.${s.id}&date=eq.${today}&select=id`);
        if (!rows[0]) continue; // 오늘 행 없으면 skip
        const prev = await select(
          "daily_records",
          `student_id=eq.${s.id}&date=lt.${today}&order=date.desc&limit=1&select=progress`
        );
        await patch("daily_records", `id=eq.${rows[0].id}`, {
          progress: advanceProgress(prev[0]?.progress, s.books, toc),
        });
        updated++;
      }
      return res.status(200).json({ updated });
    }

    // ── 담당 선생님 목록 (선생님앱 첫 화면에서 고른다) ──
    if (action === "teachers") {
      const rows = await select("students", "status=eq.재원&select=teacher");
      const teachers = [...new Set(rows.map((r) => (r.teacher || "").trim()).filter(Boolean))].sort();
      return res.status(200).json({ teachers });
    }

    // ── 과제 현황 (선생님앱) — 그날 낸 과제와 학생 체크 여부 ──
    if (action === "tasks") {
      const date = req.query.date || now.date;
      const students = await select("students", `status=eq.재원&order=name.asc${teacherFilter(req)}`);
      const ids = new Set(students.map((s) => s.id));
      const all = await select("tasks", `date=eq.${date}&order=kind.asc`);
      const tasks = all.filter((t) => ids.has(t.student_id)); // 담당 학생 것만
      const nameBy = Object.fromEntries(students.map((s) => [s.id, s.name]));
      return res.status(200).json({
        date,
        students: students.map((s) => ({ id: s.id, name: s.name, grade: s.grade, books: s.books || {} })),
        tasks: tasks.map((t) => ({
          id: t.id, student_id: t.student_id, name: nameBy[t.student_id] || "",
          kind: t.kind, subject: t.subject, title: t.title, done: t.done,
        })),
      });
    }

    // ── 과제 내주기 — 고른 학생들에게 같은 항목을 한 번에 ──
    // body: { date, student_ids:[...], items:[{kind,subject,title}, ...] }
    if (action === "save-tasks") {
      const date = req.body.date || now.date;
      const ids = Array.isArray(req.body.student_ids) ? req.body.student_ids : [];
      const items = (Array.isArray(req.body.items) ? req.body.items : [])
        .filter((it) => String(it?.title || "").trim());
      if (!ids.length) return res.status(400).json({ error: "학생을 한 명 이상 골라주세요." });
      if (!items.length) return res.status(400).json({ error: "과제 내용을 한 줄 이상 적어주세요." });

      const rows = [];
      for (const sid of ids) {
        for (const it of items) {
          rows.push({
            student_id: sid,
            date,
            kind: it.kind === "학원" ? "학원" : "집",
            subject: String(it.subject || "").trim() || null,
            title: String(it.title).trim(),
          });
        }
      }
      const created = await insert("tasks", rows);
      return res.status(200).json({ created: created.length });
    }

    if (action === "delete-task") {
      if (!req.body.id) return res.status(400).json({ error: "id 필요" });
      await remove("tasks", `id=eq.${req.body.id}`);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: `알 수 없는 action: ${action}` });
  } catch (e) {
    // 입력이 잘못된 것(BadRequest)은 400 으로, 진짜 서버 사고만 500 으로.
    // 500 에는 PostgREST 원문이 그대로 실려 화면에 내부 메시지가 노출되므로 구분합니다.
    if (e instanceof BadRequest) return res.status(400).json({ error: e.message });
    return res.status(500).json({ error: String(e.message || e) });
  }
}
