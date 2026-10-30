// SUPABASE_URL 을 다듬고, 틀렸으면 한국어로 알려주는지 — lib/db.js 단위 점검.
//
// 왜 생겼나: 설치 시뮬레이션에서 Supabase 의 **프로젝트 ID 만** 넣었더니
//   화면에 이게 그대로 떴습니다.
//     Failed to parse URL from khji…/rest/v1/students?status=eq.재원
//   Supabase 화면이 바뀌면서 Settings → General 에는 ID 만 나오기 때문에,
//   당일에 이걸 넣는 분이 반드시 나옵니다. 영어 날코드가 뜨면 아무도 못 고칩니다.
//
//   node scripts/verify/url-unit.mjs

let fail = 0;
function check(name, cond, got) {
  if (cond) console.log(`  ok  ${name}`);
  else { fail++; console.log(`  FAIL ${name}`); console.log(`       받은 것: ${JSON.stringify(got)}`); }
}

// 환경변수를 바꿔 끼우고 lib/db.js 를 새로 읽는다 (모듈이 읽을 때 한 번만 읽으므로)
let seq = 0;
async function 로드(url) {
  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_KEY = "fake-for-verify";
  return import(`../../lib/db.js?u=${++seq}`);
}

// 실제로 어떤 주소로 요청이 나가나 — fetch 를 잠깐 가짜로 바꿔 끼운다
async function 나가는주소(url) {
  const m = await 로드(url);
  const orig = globalThis.fetch;
  let 본것 = null;
  globalThis.fetch = async (u) => { 본것 = String(u); return { ok: true, json: async () => [] }; };
  try { await m.select("students", "a=1"); } catch (e) { 본것 = `던짐: ${e.name}`; }
  finally { globalThis.fetch = orig; }
  return 본것;
}

// ── 1. 틀린 꼴을 다듬어서 **같은 주소**로 만든다 ──
const 바른주소 = "https://x.supabase.co/rest/v1/students?a=1";
for (const [넣은값, 설명] of [
  ["https://x.supabase.co", "그대로"],
  ["https://x.supabase.co/", "끝에 /"],
  ["https://x.supabase.co//", "끝에 //"],
  ["https://x.supabase.co/rest/v1", "실수로 /rest/v1 까지"],
  ["https://x.supabase.co/rest/v1/", "/rest/v1/ 까지"],
  ["  https://x.supabase.co  ", "앞뒤 공백"],
]) {
  const got = await 나가는주소(넣은값);
  check(`${설명} → 바른 주소로 나간다`, got === 바른주소, { 넣은값, got });
}

// ── 2. 주소 꼴이 아니면 **막고 한국어로** 알려준다 ──
for (const [넣은값, 설명] of [
  ["khjiwjlxkbuhfgyuuysp", "프로젝트 ID 만 (Settings → General 에서 복사한 것)"],
  ["x.supabase.co", "https:// 가 없음"],
  ["supabase.co/x", "https:// 가 없음 2"],
]) {
  const m = await 로드(넣은값);
  const p = m.urlProblem();
  check(`${설명} → 막는다`, typeof p === "string" && p.length > 0, p);
  check(`${설명} → 한국어로 무엇을 넣을지 알려준다`,
    /SUPABASE_URL/.test(p || "") && /supabase\.co/.test(p || "") && /주소 전체/.test(p || ""), p);
  check(`${설명} → 지금 들어 있는 값을 보여준다`, (p || "").includes(넣은값.slice(0, 12)), p);
  check(`${설명} → Redeploy 를 눌러야 한다고 말해준다`, /Redeploy/.test(p || ""), p);

  // 그리고 실제 호출은 **영어로 터지지 않고** DbInputError 로 막혀야 한다
  const got = await 나가는주소(넣은값);
  check(`${설명} → fetch 전에 막힌다 (영어 TypeError 가 안 뜸)`, got === "던짐: DbInputError", got);
}

// ── 3. 멀쩡한 주소는 통과 ──
{
  const m = await 로드("https://x.supabase.co");
  check("바른 주소는 아무 말도 안 한다", m.urlProblem() === null, m.urlProblem());
  check("바른 주소면 설정됐다고 본다", m.dbConfigured() === true);
}
{
  // 아예 비어 있는 건 여기서 말고 「환경변수가 없어요」 쪽에서 안내합니다
  const m = await 로드("");
  check("빈 값은 여기서 말하지 않는다 (환경변수 없음 안내가 따로 있음)", m.urlProblem() === null, m.urlProblem());
  check("빈 값이면 설정 안 된 것", m.dbConfigured() === false);
}

console.log(fail ? `\n❌ 실패 ${fail}건` : "\n✅ 전부 통과");
process.exit(fail ? 1 : 0);
