// Supabase REST(PostgREST) 최소 헬퍼.
// service_role 키로 "서버(api 폴더)에서만" 호출한다. 브라우저로 절대 내보내지 말 것.
// 노션 SDK·rate limit 없이 fetch 한 방으로 테이블을 읽고 쓴다.

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

export function dbConfigured() {
  return Boolean(URL && KEY);
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
  if (!res.ok) throw new Error(`select ${table} 실패: ${res.status} ${await res.text()}`);
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
  if (!res.ok) throw new Error(`upsert ${table} 실패: ${res.status} ${await res.text()}`);
  return res.json();
}

// 새로 삽입 (id 자동 생성)
export async function insert(table, rows) {
  const res = await fetch(`${URL}/rest/v1/${table}`, {
    method: "POST",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
  });
  if (!res.ok) throw new Error(`insert ${table} 실패: ${res.status} ${await res.text()}`);
  return res.json();
}

// 조건에 맞는 행 수정. 예: patch("daily_records", "id=eq.xxx", {check_out:"19:00"})
export async function patch(table, query, body) {
  const res = await fetch(`${URL}/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`patch ${table} 실패: ${res.status} ${await res.text()}`);
  return res.json();
}

// 조건에 맞는 행 삭제. 예: remove("students", "id=eq.xxx")
export async function remove(table, query) {
  const res = await fetch(`${URL}/rest/v1/${table}?${query}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`delete ${table} 실패: ${res.status} ${await res.text()}`);
  return true;
}
