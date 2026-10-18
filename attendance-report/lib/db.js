// Supabase REST(PostgREST) 최소 헬퍼.
// service_role 키로 "서버(api 폴더)에서만" 호출한다. 브라우저로 절대 내보내지 말 것.
// 노션 SDK·rate limit 없이 fetch 한 방으로 테이블을 읽고 쓴다.

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

export function dbConfigured() {
  return Boolean(URL && KEY);
}

// PostgREST 가 주는 날코드를, 수강생이 **읽고 바로 고칠 수 있는 말**로 바꾼다.
//
// 왜 필요한가: 화면에 이런 게 그대로 떴습니다 —
//   select tasks 실패: 404 {"code":"PGRST205","message":"Could not find the table
//   'public.tasks' in the schema cache"}
// 세미나 당일에 이게 뜨면 아무도 못 고칩니다. 원인별로 할 일을 한 줄로 알려줍니다.
function friendlyDbError(op, table, status, text) {
  const t = String(text || "");
  const has = (...xs) => xs.some((x) => t.includes(x));

  // 표가 아예 없다 — setup.sql 을 안 돌렸거나, 그 표가 생기기 전에 만든 DB
  if (has("PGRST205", "42P01") || /Could not find the table/i.test(t)) {
    return (
      `DB에 '${table}' 표가 없습니다.\n` +
      `· 처음 설치라면: Supabase → SQL Editor 에서 sql/setup.sql 을 통째로 한 번 돌리세요.\n` +
      `· 쓰던 DB라면: 그 표가 생기기 전에 만든 DB입니다. sql/fix_tasks_table.sql 처럼 ` +
      `그 표만 더하는 스크립트를 돌리세요 (setup.sql 재실행 금지 — 맨 위 drop table 로 데이터가 지워집니다).`
    );
  }
  // 칸이 없다 — 표는 있는데 setup.sql 이 옛것
  if (has("PGRST204") || /Could not find the .* column/i.test(t)) {
    return (
      `'${table}' 표에 필요한 칸이 없습니다 (DB가 코드보다 옛것).\n` +
      `서버 로그의 칸 이름을 보고 alter table ... add column if not exists 로 더하세요.`
    );
  }
  // 권한 — setup.sql 아래쪽 grant 가 빠졌을 때. 미니 원서 앱 세미나에서 실제로 난 사고.
  if (has("42501") || /permission denied/i.test(t)) {
    return (
      `'${table}' 에 접근 권한이 없습니다 (service_role 권한 누락).\n` +
      `Supabase SQL Editor 에서:\n` +
      `  grant usage on schema public to service_role;\n` +
      `  grant all privileges on all tables in schema public to service_role;`
    );
  }
  // 키가 틀림 — anon 키를 넣은 경우가 제일 흔합니다
  if (status === 401 || status === 403 || has("PGRST301") || /JWT|Invalid API key/i.test(t)) {
    return (
      `DB 열쇠가 맞지 않습니다.\n` +
      `Vercel 환경변수 SUPABASE_SERVICE_KEY 에 **service_role** 키가 들어갔는지 보세요 ` +
      `(anon 키를 넣는 실수가 제일 흔합니다). 고친 뒤 재배포해야 적용됩니다.`
    );
  }
  return `${op} ${table} 실패: ${status} ${t}`;
}

function headers(extra = {}) {
  return {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

// 예: select("students", "status=eq.재원&order=name.asc")
export async function select(table, query = "") {
  const res = await fetch(`${URL}/rest/v1/${table}?${query}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(friendlyDbError("select", table, res.status, await res.text()));
  return res.json();
}

// 있으면 갱신, 없으면 삽입 (onConflict = 유니크 컬럼, 예: "student_id,month")
export async function upsert(table, rows, onConflict) {
  const q = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : "";
  const res = await fetch(`${URL}/rest/v1/${table}${q}`, {
    method: "POST",
    headers: headers({ Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
  });
  if (!res.ok) throw new Error(friendlyDbError("upsert", table, res.status, await res.text()));
  return res.json();
}

// 새로 삽입 (id 자동 생성)
export async function insert(table, rows) {
  const res = await fetch(`${URL}/rest/v1/${table}`, {
    method: "POST",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
  });
  if (!res.ok) throw new Error(friendlyDbError("insert", table, res.status, await res.text()));
  return res.json();
}

// 조건에 맞는 행 수정. 예: patch("daily_records", "id=eq.xxx", {check_out:"19:00"})
export async function patch(table, query, body) {
  const res = await fetch(`${URL}/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(friendlyDbError("patch", table, res.status, await res.text()));
  return res.json();
}

// 조건에 맞는 행 삭제. 예: remove("students", "id=eq.xxx")
export async function remove(table, query) {
  const res = await fetch(`${URL}/rest/v1/${table}?${query}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!res.ok) throw new Error(friendlyDbError("delete", table, res.status, await res.text()));
  return true;
}
