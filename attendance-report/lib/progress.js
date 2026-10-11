// 진도 자동 진행 — 교재 목차(TOC)를 순서대로 읽어 다음 진도로 넘긴다.
// 교재 유닛은 { code(유닛 코드/번호), title(실제 제목) } 구조.
//   예: { code:"Unit 12", title:"관계대명사" }  ·  { code:"Day 38", title:"환경 오염" }
//   · 지난 진도가 목차에 있으면  → step 만큼 다음 목차로 자동 전환
//   · 지난 진도가 없으면(첫날)   → 목차 1번
//   · 목차에 없거나 목차가 없으면 → 지난 값 유지(캐리포워드, 커스텀 진도 존중)

import { select } from "./db.js";

// 유닛을 {code,title} 로 정규화 (예전 문자열 데이터도 흡수).
export function normUnit(u) {
  if (u == null || u === "") return null;
  if (typeof u === "string") return { code: u, title: "" };
  return { code: u.code || "", title: u.title || "" };
}

// 교재명 → { units:[{code,title}...], step } 맵. (여러 학생이 같은 교재를 써도 한 번만 조회)
export async function tocByBook() {
  const books = await select("textbooks", "select=name,units,step");
  const map = {};
  for (const b of books) {
    map[b.name] = {
      units: (Array.isArray(b.units) ? b.units : []).map(normUnit).filter(Boolean),
      step: Number(b.step) > 0 ? Number(b.step) : 1,
    };
  }
  return map;
}

// 비교용 키 — 공백·대소문자·구두점을 지운다.
// (수기로 쓰던 진도가 "Unit 5", "unit5", "Unit 5." 처럼 제각각이라 글자 그대로 비교하면 거의 안 맞는다)
function keyOf(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, "").replace(/[.\-–—:·,/()]/g, "");
}
function numOf(s) {
  const m = String(s || "").match(/\d+/);
  return m ? m[0] : "";
}

// ★ 목차에서 '지금 진도'가 몇 번째인지 찾는다. 못 찾으면 -1.
//   2차 세미나 수강생은 진도를 **수기로** 써왔기 때문에 글자가 목차와 정확히 같을 일이 거의 없다.
//   ("Unit 5 현재완료", "unit5", "5과", "5" …) 그래서 단계적으로 느슨하게 찾는다.
//   못 찾으면 진도가 영영 안 넘어가므로(캐리포워드), 이 함수가 이 기능의 핵심이다.
export function findUnitIndex(units, last) {
  const list = Array.isArray(units) ? units : [];
  const u = normUnit(last);
  if (!list.length || !u || !u.code) return -1;
  const lc = keyOf(u.code), lt = keyOf(u.title);

  // 1) 코드가 같다 (공백·대소문자·구두점 무시)
  let i = list.findIndex((x) => keyOf(x.code) === lc);
  if (i >= 0) return i;

  // 2) 수기 진도가 "코드 + 제목" 형태 → 코드로 시작하는 것.
  //    "Unit 15" 가 "Unit 1" 에 잘못 붙지 않도록 **가장 긴 코드**를 고른다.
  let best = -1, bestLen = 0;
  list.forEach((x, idx) => {
    const k = keyOf(x.code);
    if (k && lc.startsWith(k) && k.length > bestLen) { best = idx; bestLen = k.length; }
  });
  if (best >= 0) return best;

  // 3) 제목만 쓴 경우 ("현재완료")
  if (lc) { i = list.findIndex((x) => keyOf(x.title) && keyOf(x.title) === lc); if (i >= 0) return i; }
  if (lt) { i = list.findIndex((x) => keyOf(x.title) === lt); if (i >= 0) return i; }

  // 4) 숫자만 같은 경우 ("5", "5과" ↔ "Unit 5").
  //    같은 숫자를 가진 유닛이 **하나뿐일 때만** — 여럿이면 어느 것인지 알 수 없으니 포기.
  const n = numOf(u.code);
  if (n) {
    const hits = list.map((x, idx) => ({ idx, n: numOf(x.code) })).filter((x) => x.n === n);
    if (hits.length === 1) return hits[0].idx;
  }
  return -1;
}

// 진도가 목차와 연결됐는지 알려준다 (화면에서 "왜 안 넘어가지?" 를 바로 보여주려고).
//   no-book   교재 미지정 / no-toc 목차 없음 / first 첫 진도 / linked 연결됨 / unlinked 목차에 없음
export function linkStatus(lastProgress, books, toc) {
  const out = {};
  for (const [subject, bookName] of Object.entries(books || {})) {
    if (!bookName) { out[subject] = { state: "no-book" }; continue; }
    const entry = (toc || {})[bookName];
    const units = entry?.units || [];
    const last = normUnit((lastProgress || {})[subject]);
    if (!units.length) { out[subject] = { state: "no-toc", book: bookName }; continue; }
    if (!last || !last.code) { out[subject] = { state: "first", book: bookName, total: units.length }; continue; }
    const i = findUnitIndex(units, last);
    out[subject] = i >= 0
      ? { state: "linked", book: bookName, at: i + 1, total: units.length }
      : { state: "unlinked", book: bookName, total: units.length, value: last.code };
  }
  return out;
}

// 다음 진도 계산. lastProgress={과목:{code,title}}, books={과목:교재명}, toc={교재명:{units,step}}
export function advanceProgress(lastProgress, books, toc) {
  const out = {};
  for (const [subject, bookName] of Object.entries(books || {})) {
    const entry = (toc || {})[bookName];
    const units = entry?.units;
    const step = entry?.step || 1;
    const last = normUnit((lastProgress || {})[subject]);
    if (Array.isArray(units) && units.length) {
      if (!last || !last.code) {
        out[subject] = units[0]; // 첫 진도는 목차 1번
      } else {
        const i = findUnitIndex(units, last); // 수기로 쓴 진도도 찾아낸다
        if (i >= 0) out[subject] = units[Math.min(i + step, units.length - 1)]; // step 만큼(끝이면 유지)
        else out[subject] = last; // 목차에서 못 찾음 → 유지 (화면에 '목차와 연결 안 됨'으로 표시됨)
      }
    } else if (last && last.code) {
      out[subject] = last; // 목차 없음 → 캐리포워드
    }
  }
  return out;
}
