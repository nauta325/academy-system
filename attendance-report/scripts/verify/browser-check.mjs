// 모든 화면을 실제 브라우저로 열어 JS 오류·빈 화면을 잡는다.
// (미니 원서 앱 때처럼 "열어보니 에러" 를 세미나 당일이 아니라 지금 잡으려고)
import { chromium } from "playwright";
const B = "http://localhost:4330";
const EXE = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const b = await chromium.launch({ executablePath: EXE });
let fail = 0;
const ck = (l, c, d) => { console.log(`${c ? "  ok " : "FAIL "} ${l}${c ? "" : "  → " + String(JSON.stringify(d ?? null)).slice(0, 200)}`); if (!c) fail++; };

// 각 화면: 경로, 로딩 끝났다고 볼 조건, 비어 있으면 안 되는 곳
const PAGES = [
  { p: "/", wait: ".card", must: "a[href='/daily.html']" },
  { p: "/board.html", wait: "body", must: null },
  { p: "/daily.html", wait: "body", must: null },
  { p: "/students.html", wait: "body", must: null },
  { p: "/books.html", wait: "body", must: null },
  { p: "/kiosk.html", wait: "body", must: null },
  { p: "/report.html", wait: "body", must: null },
  { p: "/teacher.html", wait: "body", must: null },
  { p: "/student.html", wait: "body", must: null },
  { p: "/import.html", wait: "body", must: null },
  { p: "/handout.html", wait: "body", must: null },
  { p: "/parent.html", wait: "body", must: null },
];

for (const page of PAGES) {
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  pg.on("pageerror", (e) => errs.push("JS: " + e.message));
  pg.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_|favicon/i.test(m.text())) errs.push("콘솔: " + m.text()); });
  pg.on("requestfailed", (r) => { const u = r.url(); if (u.startsWith(B) && !/favicon/.test(u)) errs.push("요청실패: " + u.replace(B, "")); });

  let ok = true, detail = null;
  try {
    const res = await pg.goto(B + page.p, { waitUntil: "networkidle", timeout: 20000 });
    if (!res || res.status() >= 400) { ok = false; detail = "HTTP " + (res && res.status()); }
    await pg.waitForTimeout(900); // 초기 fetch 가 끝날 시간
    const txt = (await pg.locator("body").innerText()).trim();
    if (ok && txt.length < 10) { ok = false; detail = "화면이 비어 있음"; }
    if (ok && page.must && (await pg.locator(page.must).count()) === 0) { ok = false; detail = "필수 요소 없음: " + page.must; }
  } catch (e) { ok = false; detail = e.message.slice(0, 120); }

  ck(`${page.p.padEnd(18)} 로드`, ok, detail);
  ck(`${page.p.padEnd(18)} JS 오류 없음`, errs.length === 0, errs.slice(0, 3));
  await pg.close();
}

// ── 실제 조작 한 바퀴 ──
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
pg.on("pageerror", (e) => errs.push("JS: " + e.message));

// 데일리 리포트: 학생이 보이고 진도 칸이 채워져 있나
await pg.goto(B + "/daily.html", { waitUntil: "networkidle" });
await pg.waitForTimeout(1200);
const cards = await pg.locator(".card").count();
ck("daily.html 학생 카드가 보임", cards >= 1, { cards });
const selects = await pg.locator("select[data-sub]").count();
ck("★ daily.html 진도 드롭다운(목차 연결됨)", selects >= 1, { selects });
const firstVal = selects ? await pg.locator("select[data-sub]").first().inputValue() : "";
ck("★ 진도가 비어 있지 않음(자동으로 채워짐)", !!firstVal, { firstVal });

// 교재·목차
await pg.goto(B + "/books.html", { waitUntil: "networkidle" });
await pg.waitForTimeout(900);
ck("books.html 교재 목록 보임", (await pg.locator("body").innerText()).includes("그래머"), null);

// 현황판
await pg.goto(B + "/board.html", { waitUntil: "networkidle" });
await pg.waitForTimeout(900);
ck("board.html 학생 보임", (await pg.locator("body").innerText()).includes("김민준"), null);

// 선생님앱: 담당 선택 → 담당 학생만
await pg.goto(B + "/teacher.html", { waitUntil: "networkidle" });
await pg.waitForTimeout(1200);
const opts = await pg.locator("#teacher option").count();
ck("teacher.html 담당 선생님 목록", opts >= 3, { opts });
await pg.selectOption("#teacher", "박선생");
await pg.waitForTimeout(1200);
const body = await pg.locator("body").innerText();
ck("★ 담당 학생만 보임 (박도윤 O / 김민준 X)", body.includes("박도윤") && !body.includes("김민준"), body.slice(0, 160));

// 학생앱 로그인
await pg.goto(B + "/student.html", { waitUntil: "networkidle" });
await pg.fill("#code", "demo01"); await pg.fill("#pin", "1111");
await pg.click("button.btn");
await pg.waitForTimeout(1500);
ck("★ 학생앱 로그인 성공", (await pg.locator("#home").isVisible()), await pg.locator("#err").innerText());
ck("학생앱 과제 보임", (await pg.locator(".task").count()) >= 1, { n: await pg.locator(".task").count() });

ck("조작 중 JS 오류 없음", errs.length === 0, errs.slice(0, 3));
await b.close();
console.log(fail ? `\n❌ 실패 ${fail}건` : "\n✅ 전부 통과");
process.exit(fail ? 1 : 0);
