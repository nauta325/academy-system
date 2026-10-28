export const B = process.env.SC_BASE || "http://127.0.0.1:4331";
export const TODAY = new Date().toISOString().slice(0, 10);
export const 지난달 = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();
export const state = { n: 0, fail: 0, bad: [], 시나리오: "" };

export function 시작(name) { state.시나리오 = name; console.log(`\n── ${name} ──`); }
export function ck(name, ok, d) {
  state.n++;
  if (!ok) { state.fail++; state.bad.push(`[${state.시나리오}] ${name}  → ${JSON.stringify(d)}`); console.log("  FAIL  " + name + "  → " + JSON.stringify(d)); }
  else console.log("  ok  " + name);
  return ok;
}
export const get = async (p, q) => { const r = await fetch(`${B}${p}?${q}`); return { s: r.status, d: await r.json().catch(() => ({})) }; };
export const post = async (p, b) => { const r = await fetch(`${B}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); return { s: r.status, d: await r.json().catch(() => ({})) }; };
export function 끝() {
  console.log(`\n점검 ${state.n}개 · 실패 ${state.fail}개`);
  if (state.bad.length) { console.log("\n실패:"); state.bad.forEach(x => console.log("  ❌ " + x)); }
  process.exit(state.fail ? 1 : 0);
}
// 응답 모양을 먼저 찍어 보고 쓰기 — 짐작으로 쓰다 여러 번 틀렸습니다.
export function 모양(label, o) { console.log(`     (${label} 키: ${Object.keys(o || {}).join(", ")})`); }
