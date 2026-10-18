// DB 에러를 수강생이 읽을 수 있는 말로 바꾸는지 — lib/db.js 단위 점검.
//
// 왜 생겼나: 리허설에서 월말평가서 화면에 이게 그대로 떴습니다.
//   select tasks 실패: 404 {"code":"PGRST205","message":"Could not find the table
//   'public.tasks' in the schema cache"}
// 세미나 당일 이게 뜨면 수강생은 아무것도 못 합니다. 원인별로 할 일이 보여야 합니다.
//
//   node scripts/verify/db-error-unit.mjs

import { select } from "../../lib/db.js";

let fail = 0;
function check(name, cond, got) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    fail++;
    console.log(`  FAIL ${name}`);
    console.log(`       받은 것: ${JSON.stringify(got)}`);
  }
}

// select() 가 던지는 메시지를 보기 위해 fetch 를 잠깐 가짜로 바꿔 끼운다.
async function messageFor(status, body) {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status, text: async () => body });
  try {
    await select("tasks", "");
    return null; // 에러가 안 났다 = 잘못됨
  } catch (e) {
    return e.message;
  } finally {
    globalThis.fetch = orig;
  }
}

const RAW = /PGRST\d+|schema cache|permission denied for table|Invalid API key/;

{
  const m = await messageFor(
    404,
    JSON.stringify({ code: "PGRST205", message: "Could not find the table 'public.tasks' in the schema cache" })
  );
  check("★ 표가 없을 때 — 무엇을 돌려야 하는지 알려준다",
    m?.includes("표가 없습니다") && m.includes("setup.sql"), m);
  check("★ 쓰던 DB 는 setup.sql 재실행하지 말라고 경고한다",
    m?.includes("재실행 금지"), m);
  check("날코드(PGRST205·schema cache)가 그대로 새지 않는다", !RAW.test(m || ""), m);
}

{
  const m = await messageFor(403, JSON.stringify({ code: "42501", message: "permission denied for table students" }));
  check("★ 권한 누락 — grant 문을 그대로 보여준다",
    m?.includes("service_role") && m.includes("grant usage on schema public"), m);
  check("날코드가 그대로 새지 않는다", !RAW.test(m || ""), m);
}

{
  const m = await messageFor(401, JSON.stringify({ message: "Invalid API key" }));
  check("★ 키가 틀렸을 때 — anon 키 실수를 짚어준다",
    m?.includes("SUPABASE_SERVICE_KEY") && m.includes("anon"), m);
  check("날코드가 그대로 새지 않는다", !RAW.test(m || ""), m);
}

{
  const m = await messageFor(400, JSON.stringify({ code: "PGRST204", message: "Could not find the 'retest_sent' column" }));
  check("칸이 없을 때 — add column 을 안내한다", m?.includes("add column"), m);
}

{
  // 모르는 에러는 숨기지 말고 그대로 보여줘야 한다 (디버깅 가능해야 하므로)
  const m = await messageFor(500, "boom");
  check("모르는 에러는 원문을 그대로 남긴다", m?.includes("500") && m.includes("boom"), m);
}

console.log(fail ? `\n❌ 실패 ${fail}건` : "\n✅ 전부 통과");
process.exit(fail ? 1 : 0);
