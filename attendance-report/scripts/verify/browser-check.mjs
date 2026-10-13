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
  { p: "/student_card.html", wait: "body", must: null },
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
// 지난 수업 3회 요약 — 진도·단어테스트 흐름이 보여야 함
{
  const rec = await pg.locator(".hist").first().innerText().catch(() => "");
  ck("★ 최근 수업 표가 보임", /최근 수업/.test(rec), rec.slice(0, 140));
  ck("★ 단어 TEST 칸이 있음", /단어 TEST/.test(rec), rec.slice(0, 140));
  ck("날짜가 MM/DD 로 나옴 (ISO 가 새지 않음)", !/T\d\d:/.test(rec), rec.slice(0, 140));
  ck("요일이 같이 나옴", /\d\d\/\d\d\s*[일월화수목금토]/.test(rec), rec.slice(0, 140));
  ck("값이 없으면 '-' 로 채움", /-/.test(rec), rec.slice(0, 140));
  // 「더 보기」 를 누르면 줄이 늘어나야 한다
  const before = await pg.locator(".hist tbody tr").count();
  const more = pg.locator(".hist .more").first();
  if (await more.count()) {
    await more.click(); await pg.waitForTimeout(600);
    const after = await pg.locator(".hist tbody tr").count();
    ck("★ 「더 보기」로 줄이 늘어남", after > before, { before, after });
  }
  const prev = await pg.locator(".prev").first().innerText().catch(() => "");
  ck("과목 줄에 지난 진도가 보임", /지난|직전/.test(prev), prev.slice(0, 100));
}

// 📨 카톡 미리보기 — 원장님이 매일 쓰는 화면인데 검사에서 빠져 있었습니다.
//    여기서 과목별 교재·진도가 보여야 "보내기 전에" 빈칸을 잡을 수 있습니다.
{
  const btn = pg.locator("button", { hasText: "리포트 카톡" }).first();
  if (await btn.count()) {
    await btn.click();
    await pg.waitForTimeout(1200);
    const open = await pg.locator("#overlay.on").count();
    ck("★ 카톡 미리보기가 열림", open === 1, { open });
    const txt = open ? await pg.locator("#sendList").innerText() : "";
    ck("★ 미리보기에 과목별 교재·진도가 보임", /카톡에 들어갈 과목/.test(txt), txt.slice(0, 160));
    ck("★ 교재명이 '-' 가 아님", /그래머|리딩|보카/.test(txt), txt.slice(0, 160));
  } else {
    ck("★ 카톡 미리보기 버튼 있음", false, "버튼을 찾지 못함");
  }
}

// ★ 붙여넣기 일괄등록 → 그 학생이 학생앱에 로그인되나
//   예전에는 일괄등록 파서가 student_code(학생ID) 를 아예 읽지 않아서,
//   일괄등록으로 넣은 학생은 전부 학생앱 로그인이 안 됐습니다(로그인 = 학생ID + PIN).
//   조용히 비는 값이라 세미나 당일에야 "학생앱이 안 돼요" 로 드러날 자리였습니다.
//   ⚠️ 로그인 상태가 뒤의 점검에 새지 않도록 **별도 컨텍스트**에서 돌립니다.
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 950 } });
  const p2 = await ctx.newPage();
  const dl = [];
  p2.on("dialog", async (d) => { dl.push(d.message()); await d.accept().catch(() => {}); });
  await p2.goto(B + "/students.html", { waitUntil: "networkidle" });
  await p2.waitForTimeout(1000);
  const code = "vfy" + String(Date.now()).slice(-5);
  if (await p2.locator("#bulkBtn").count()) {
    await p2.locator("#bulkBtn").click();
    await p2.waitForTimeout(400);
    await p2.locator("#bulkText").fill(`검수학생\t${code}\t4242\t중1\t이선생\t010-4242-4242`);
    await p2.locator("#bulkSave").click();
    await p2.waitForTimeout(2200);
    ck("★ 일괄등록에 학생ID가 들어감", (await p2.locator("body").innerText()).includes(code), dl.slice(0, 2));
    await p2.goto(B + "/student.html", { waitUntil: "networkidle" });
    await p2.waitForTimeout(800);
    const ii = await p2.locator("input:visible").all();
    if (ii.length >= 2) {
      await ii[0].fill(code); await ii[1].fill("4242");
      await p2.locator("button:visible").first().click();
      await p2.waitForTimeout(2000);
    }
    ck("★★ 일괄등록한 학생이 학생앱에 로그인됨", (await p2.locator("body").innerText()).includes("검수학생"), null);
  } else {
    ck("★ 일괄등록 버튼 있음", false, "없음");
  }
  await ctx.close();
}

// ★ 🔁 재시 안내 — 불통과를 저장하면 버튼이 나타나고, 미리보기에 그 학생이 보여야 한다
//   (예전에는 재시를 보낼 자리가 없어서, 미통과한 아이가 같은 유닛에 그냥 멈춰 있었습니다)
{
  await pg.goto(B + "/daily.html", { waitUntil: "networkidle" });
  await pg.waitForTimeout(1200);
  const seg = pg.locator('.seg[data-field="voca_test"] button:has-text("불통과")').first();
  if (await seg.count()) {
    await seg.click();
    await pg.waitForTimeout(1600);           // 자동 저장(700ms 디바운스) 기다림
    await pg.reload({ waitUntil: "networkidle" });
    await pg.waitForTimeout(1400);
    const btn = pg.locator("#retest");
    ck("★ 「🔁 재시 안내」 버튼이 나타남", await btn.isVisible(), await btn.textContent().catch(() => null));
    ck("버튼에 대상 인원수가 적힘", /\(\d+\)/.test((await btn.textContent()) || ""), await btn.textContent().catch(() => null));
    ck("카드에 「재시 안내 대기」 표시", (await pg.locator("body").innerText()).includes("재시 안내 대기"), null);
    await btn.click();
    await pg.waitForTimeout(1400);
    ck("★ 재시 미리보기가 열림", (await pg.locator("#rOverlay.on").count()) === 1, null);
    const rt = await pg.locator("#rList").innerText().catch(() => "");
    ck("미리보기에 단어교재·점수가 보임", /단어\s|점수/.test(rt), rt.slice(0, 160));
    await pg.locator("#rCancel").click();
    await pg.waitForTimeout(300);
  } else {
    ck("★ 단어테스트 불통과 버튼 있음", false, "버튼을 찾지 못함");
  }
}

// ★ 📋 학생 카드 — 데일리 리포트에서 학생 이름을 누르면 지난 진도가 쭉 보여야 한다
{
  await pg.goto(B + "/daily.html", { waitUntil: "networkidle" });
  await pg.waitForTimeout(1200);
  const link = pg.locator("a.nm").first();
  ck("★ daily.html 학생 이름이 학생 카드 링크", await link.count() > 0, null);
  const href = (await link.getAttribute("href")) || "";
  ck("링크에 student_id 가 붙음", /student_card\.html\?student_id=.+/.test(href), href);

  await pg.goto(B + href, { waitUntil: "networkidle" });
  await pg.waitForTimeout(1600);
  const body2 = await pg.locator("body").innerText();
  ck("★ 학생 카드가 열림 (학생 이름 나옴)", /김민준|이서연|박도윤/.test(body2), body2.slice(0, 160));
  ck("★ 📊 과목별 진도 흐름이 보임", /과목별 진도/.test(body2), body2.slice(0, 200));
  ck("★ 📅 진도 표가 보임", (await pg.locator("table.pt").count()) >= 1, null);
  ck("표에 단어 TEST 칸이 있음", /단어 TEST/.test(body2), null);
  ck("날짜가 MM/DD 요일 로 나옴 (ISO 가 새지 않음)", !/T\d\d:/.test(body2) && /\d\d\/\d\d\s*[일월화수목금토]/.test(body2), body2.slice(0, 200));
  const trs = await pg.locator("table.pt tbody tr").count();
  ck("표에 수업 줄이 들어 있음", trs >= 1, { trs });
  // 설치 직후 샘플은 과거 기록이 2026-05 뿐이라 기간(최대 90일) 안에 오늘치만 들어옵니다.
  // 그때 "고장난 게 아니다 + test_3_month.sql 을 돌리면 된다" 가 화면에 떠야 합니다.
  if (trs <= 1) ck("★ 기록이 적을 때 해결법을 알려 줌", /test_3_month\.sql/.test(body2), body2.slice(0, 400));
  // 기간을 바꿔도 화면이 깨지지 않아야 한다
  await pg.locator('#seg button[data-d="7"]').click();
  await pg.waitForTimeout(1500);
  const n7 = await pg.locator("table.pt tbody tr").count();
  ck("1주로 좁혀도 화면이 안 깨짐", (await pg.locator("body").innerText()).length > 50, { n7 });
  await pg.locator('#seg button[data-d="90"]').click();
  await pg.waitForTimeout(1800);
  const n90 = await pg.locator("table.pt tbody tr").count();
  ck("★ 기간(1주/3달)을 바꾸면 줄 수가 늘거나 같음", n90 >= n7, { n7, n90 });
  ck("기간을 바꾸면 주소에도 남음 (새로고침해도 유지)", /days=90/.test(pg.url()), pg.url());
  // 학생을 바꾸면 그 학생 것으로 바뀌어야 한다
  const opts = await pg.locator("#stu option").count();
  ck("학생 고르기 드롭다운", opts >= 3, { opts });
  ck("날짜별 자세히가 보임", /날짜별 자세히/.test(await pg.locator("body").innerText()), null);
}

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
// 과제 이력 드롭다운도 담당 학생만이어야 한다 (선생님을 바꾸면 다시 채워져야 함)
{
  const names = await pg.locator("#hStudent option").allInnerTexts().catch(() => []);
  ck("★ 과제 이력 드롭다운도 담당 학생만", names.length > 0 && !names.includes("김민준"), names);
  // 기간 조회가 실제로 되는지
  await pg.locator("#hFrom").fill("2026-01-01");
  await pg.locator("#hTo").fill("2026-12-31");
  await pg.locator("button:has-text('보기')").first().click();
  await pg.waitForTimeout(1500);
  const h = await pg.locator("#hstats").innerText().catch(() => "");
  ck("★ 학생별 과제 이력이 조회됨", /완료율|받은 과제/.test(h), h.slice(0, 120));
  // 「미완료만」 이 기본으로 켜져 있어야 한다 (운영 과제 현황 화면과 같은 기본값 —
  // 선생님이 이력에서 찾는 건 "누가 안 했나" 이기 때문)
  const pendOn = await pg.locator("#hPending").isChecked().catch(() => null);
  ck("★ 「미완료만」이 기본으로 켜져 있음", pendOn === true, pendOn);
  const onlyPending = await pg.locator("#history .tline .st").allInnerTexts().catch(() => []);
  ck("미완료만 켜면 완료 건이 안 보임", onlyPending.every((x) => x.includes("미완료")), onlyPending.slice(0, 5));
  await pg.locator("#hPending").uncheck();
  await pg.waitForTimeout(600);
  const allRows = await pg.locator("#history .tline").count().catch(() => 0);
  ck("끄면 전부 보임", allRows >= onlyPending.length, { allRows, pending: onlyPending.length });
}

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
