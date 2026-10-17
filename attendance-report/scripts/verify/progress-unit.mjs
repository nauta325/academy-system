// advanceProgress 의 경계 동작만 직접 확인한다 (DB·서버 없이).
// daily-rows 로는 못 보는 것들: 목차 끝에서 멈추는지, 목차에 없는 값을 지키는지.
import { advanceProgress } from "../../lib/progress.js";

const units = [
  { code: "Unit 1", title: "be동사" },
  { code: "Unit 2", title: "일반동사" },
  { code: "Unit 3", title: "현재진행" },
];
const toc = { "그래머1": { units, step: 1 } };
const books = { 문법: "그래머1" };

let fail = 0;
const is = (name, got, want) => {
  const ok = got === want;
  console.log(`  ${ok ? "ok " : "❌ "} ${name}${ok ? "" : ` — 기대 "${want}", 받음 "${got}"`}`);
  if (!ok) fail = 1;
};
const code = (r) => (r.문법 && r.문법.code) || String(r.문법 ?? "");

is("첫 진도는 목차 1번", code(advanceProgress(null, books, toc)), "Unit 1");
is("한 칸 전진", code(advanceProgress({ 문법: { code: "Unit 1" } }, books, toc)), "Unit 2");
is("★ 목차 끝에서는 멈춤", code(advanceProgress({ 문법: { code: "Unit 3" } }, books, toc)), "Unit 3");
is("수기로 쓴 '3과' 도 찾아냄", code(advanceProgress({ 문법: { code: "3과" } }, books, toc)), "Unit 3");
is("목차에 없는 값은 그대로 유지",
   code(advanceProgress({ 문법: { code: "특별수업" } }, books, toc)), "특별수업");
is("하루 2유닛(step) 적용",
   code(advanceProgress({ 문법: { code: "Unit 1" } }, books, { "그래머1": { units, step: 2 } })), "Unit 3");
is("목차 없는 교재는 지난 값 유지",
   code(advanceProgress({ 문법: { code: "Unit 9" } }, books, { "그래머1": { units: [], step: 1 } })), "Unit 9");

console.log(fail ? "\n❌ 경계 동작 실패" : "\n✅ 경계 동작 통과");
process.exit(fail);
