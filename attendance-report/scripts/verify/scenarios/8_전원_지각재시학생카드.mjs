// 3부 — 지각 판정 · 단어 불통과→재시 · 학생 카드 · 과제 이력 · 평가서 다시 열기/삭제
const B = process.env.SC_BASE || "http://127.0.0.1:4331";
let fail=0,n=0; const bad=[];
const ck=(name,ok,d)=>{n++; if(!ok){fail++;bad.push(name+"  → "+JSON.stringify(d));} return ok;};
const get=async(p,q)=>{const r=await fetch(`${B}${p}?${q}`);return{s:r.status,d:await r.json().catch(()=>({}))};};
const post=async(p,b)=>{const r=await fetch(`${B}${p}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)});return{s:r.status,d:await r.json().catch(()=>({}))};};
const TODAY=new Date().toISOString().slice(0,10);
const 지난달=(()=>{const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-1);return d.toISOString().slice(0,7);})();
const students=(await get("/api/attendance","action=students")).d.students.sort((a,b)=>a.name.localeCompare(b.name));

// ── 1. 지각 판정
console.log("── 지각 판정 ──");
const rows=(await get("/api/attendance",`action=daily-rows&date=${TODAY}`)).d.rows||[];
let 지각수=0, 정시수=0;
for (const r of rows) {
  const ci=r.record?.check_in, lt=r.record?.lateness;
  if (!ci) continue;
  if (lt==="결석") continue;   // 결석으로 적어둔 행은 지각/정시 대상이 아닙니다
  if (lt==="지각") 지각수++; else 정시수++;
  const 예정=r.scheduled;
  console.log(`  ${r.name.padEnd(5)} 예정 ${예정||"-"} 등원 ${ci} → ${lt||"정시"}`);
  ck(`${r.name}: 등원했으면 지각/정시가 정해진다`, lt==="지각"||lt==="정시", lt);
  if (!r.scheduled) ck(`${r.name}: 예정 시간이 없으면(보강) 지각이 아니다`, lt==="정시", lt);
}
ck("★ 등원한 학생 중 지각 판정이 돈다 (예정시간이 지났으므로)", 지각수>0, {지각수,정시수});

// ── 2. 단어 불통과 → 재시 큐 → 발송
console.log("\n── 단어 테스트 불통과 → 재시 안내 ──");
const 대상=students[0];
await post("/api/attendance",{action:"save-record",student_id:대상.id,date:TODAY,fields:{voca_test:"불통과",voca_score:"12/20"}});
let rr=(await get("/api/attendance",`action=daily-rows&date=${TODAY}`)).d.rows.find(x=>x.student_id===대상.id);
ck(`${대상.name}: 불통과로 적으면 재시 큐에 올라간다`, rr?.record?.retest_sent==="미전송", rr?.record?.retest_sent);
const sr=await post("/api/attendance",{action:"send-retest",date:TODAY,dryRun:true});
console.log("  재시 대상:", sr.d.total ?? "(모름)", "명 · 응답키:", Object.keys(sr.d).join(","));
ck("재시 안내 미리보기가 돈다", sr.s===200, sr.d);
await post("/api/attendance",{action:"save-record",student_id:대상.id,date:TODAY,fields:{voca_test:"통과",voca_score:"19/20"}});
rr=(await get("/api/attendance",`action=daily-rows&date=${TODAY}`)).d.rows.find(x=>x.student_id===대상.id);
ck(`${대상.name}: ★ 통과로 고치면 큐에서 내려온다`, !rr?.record?.retest_sent, rr?.record?.retest_sent);

// ── 3. 학생 카드 — 열두 명 전원
console.log("\n── 학생 카드 (지난 진도) ──");
for (const s of students) {
  const h=await get("/api/attendance",`action=student-history&student_id=${s.id}&days=90`);
  ck(`${s.name}: 학생 카드가 열린다`, h.s===200 && h.d.student?.name===s.name, h.d.error);
  ck(`${s.name}: 지난 수업 기록이 있다`, (h.d.rows||[]).length>0, (h.d.rows||[]).length);
  ck(`${s.name}: 과목별 흐름이 있다`, (h.d.subjects||[]).length>0, h.d.subjects);
  ck(`${s.name}: ★ 날짜가 ISO 로 안 샌다`, !(h.d.rows||[]).some(r=>/T\d\d:/.test(String(r.date))), (h.d.rows||[])[0]?.date);
  ck(`${s.name}: ★★ 남의 기록이 안 섞인다`, h.d.student?.id===s.id, h.d.student?.id);
}
console.log(`  열두 명 전원 열림`);

// ── 4. 과제 이력 (기간 조회)
console.log("\n── 과제 이력 (기간) ──");
for (const s of students.slice(0,4)) {
  const t=await get("/api/attendance",`action=tasks&from=${지난달}-01&to=${TODAY}&student_id=${s.id}`);
  ck(`${s.name}: 과제 이력이 조회된다`, t.s===200 && Array.isArray(t.d.tasks), t.d.error);
  ck(`${s.name}: 완료율이 같이 온다`, t.d.summary && typeof t.d.summary.total==="number", t.d.summary);
  ck(`${s.name}: ★★ 본인 것만 온다`, (t.d.tasks||[]).every(x=>x.student_id===s.id), "남의 것 섞임");
  console.log(`  ${s.name}: ${t.d.summary?.total}건 · 완료 ${t.d.summary?.done} · ${t.d.summary?.rate}%`);
}

// ── 5. 평가서 다시 열기 / 삭제
console.log("\n── 평가서 다시 열기·삭제 ──");
const wl=await get("/api/report",`action=students-with-reports&month=${지난달}`);
ck("저장된 평가서가 있는 학생 목록이 온다", wl.s===200 && (wl.d.students||[]).length===12, (wl.d.students||[]).length);
const 하나=students[11];
const sr2=await get("/api/report",`action=student-reports&student_id=${하나.id}`);
ck(`${하나.name}: 이 학생의 평가서 목록이 온다`, sr2.s===200 && (sr2.d.reports||[]).length>0, sr2.d);
const g2=await get("/api/report",`action=get&student_id=${하나.id}&month=${지난달}`);
ck(`${하나.name}: 본문·통계·진도가 그대로 있다`, g2.d.report?.body && g2.d.report?.stats && g2.d.report?.progress, Object.keys(g2.d.report||{}));
const del=await post("/api/report",{action:"delete",student_id:하나.id,month:지난달});
ck(`${하나.name}: 삭제된다`, del.s===200, del.d);
const after=await get("/api/report",`action=get&student_id=${하나.id}&month=${지난달}`);
ck(`${하나.name}: ★ 삭제 뒤에는 안 나온다`, !after.d.report?.body, after.d.report);

console.log(`\n점검 ${n}개 · 실패 ${fail}개`);
if(bad.length){console.log("\n실패한 것:");bad.forEach(x=>console.log("  ❌ "+x));}
process.exit(fail?1:0);
