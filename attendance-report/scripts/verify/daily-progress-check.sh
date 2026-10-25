#!/bin/bash
# 「진도 자동 전환」 매일 점검 — 세미나(11/1)까지 하루 한 번 돌린다.
#
# 왜 따로 두나: 이 세미나의 간판이 '진도를 손으로 안 쓴다' 인데, 여기가 조용히 깨지면
# 당일 수강생 화면에서 바로 들통난다. verify.sh 는 전면 검수(느림)라서
# 이 스크립트는 **진도 사슬만** 빠르게 본다.
#
# 쓰는 법:  bash scripts/verify/daily-progress-check.sh
# 마지막 줄이 "✅ 진도 점검 통과" 여야 한다. 아니면 그 위에 이유가 찍힌다.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$HERE/../.." && pwd)"
export PGSOCK="${PGSOCK:-/var/run/postgresql}"   # /tmp 는 정리돼서 소켓이 사라집니다
PS="psql -h $PGSOCK -p 5433 -U postgres"
DB=pcheck
FAIL=0
note() { echo "  $1"; }
bad()  { echo "  ❌ $1"; FAIL=1; }

# ── 0. 테스트용 PostgreSQL 준비 (없으면 만들고, 꺼져 있으면 켠다) ──────────
if ! $PS -tAc "select 1" >/dev/null 2>&1; then
  if [ ! -f /var/lib/pgtest/PG_VERSION ]; then
    rm -rf /var/lib/pgtest && mkdir -p /var/lib/pgtest && chown postgres:postgres /var/lib/pgtest
    su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/initdb -D /var/lib/pgtest -A trust -U postgres" >/dev/null 2>&1
  fi
  su postgres -s /bin/bash -c \
    "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/pgtest -o '-p 5433 -k /var/run/postgresql' -l /var/lib/pgtest/log start" >/dev/null 2>&1
  sleep 3
fi
$PS -tAc "select 1" >/dev/null 2>&1 || { echo "❌ 테스트용 PostgreSQL(5433)을 못 띄웠습니다"; exit 1; }

cd "$HERE"
[ -d node_modules ] || npm i --silent --no-audit --no-fund >/dev/null 2>&1

echo "── 깨끗한 DB 에 설치 ──"
$PS -q -c "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
$PS -d $DB -q -c "create role service_role nologin" -c "create extension if not exists pgcrypto" >/dev/null 2>&1
ERR=$($PS -d $DB -v ON_ERROR_STOP=1 -q -f "$APP/sql/setup.sql" 2>&1 | grep -i error | head -2)
[ -n "$ERR" ] && { echo "❌ setup.sql 오류: $ERR"; exit 1; }
note "setup.sql OK"

echo "── 서버 기동 ──"
(fuser -k 4331/tcp >/dev/null 2>&1 || true); sleep 1
PORT=4331 TESTDB=$DB nohup node app-server.mjs > /tmp/pcheck.log 2>&1 < /dev/null &
disown 2>/dev/null || true
for i in $(seq 1 20); do
  curl -s -o /dev/null localhost:4331/ && break; sleep 0.5
done
curl -s -o /dev/null localhost:4331/ || { echo "❌ 서버가 안 떴습니다"; tail -5 /tmp/pcheck.log; exit 1; }
note "서버 OK"

# ── 1. 한 학생의 수업일을 차례로 돌려 진도가 한 칸씩 가는지 ───────────────
echo "── 1. 진도가 한 칸씩 넘어가나 ──"
SID=$($PS -d $DB -tAc "select id from students where name='김민준'")
[ -z "$SID" ] && { echo "❌ 샘플 학생(김민준)이 없습니다"; exit 1; }
$PS -d $DB -q -c "delete from daily_records where student_id='$SID'" >/dev/null

# 김민준은 월·수·금 수업. 연속한 수업일 5번을 만든다.
for d in 2026-10-05 2026-10-07 2026-10-09 2026-10-12 2026-10-14; do
  curl -s "localhost:4331/api/attendance?action=daily-rows&date=$d" -o /dev/null
done

CHAIN=$($PS -d $DB -tAc "
  select string_agg(progress->'문법'->>'code', ' → ' order by date)
  from daily_records where student_id='$SID'")
note "문법: $CHAIN"
EXPECT="Unit 1 → Unit 2 → Unit 3 → Unit 4 → Unit 5"
[ "$CHAIN" = "$EXPECT" ] || bad "기대: $EXPECT"

# ── 2. 아직 안 쓴 날을 만들면 '다음 목차'가 들어오나 (cron 과 같은 길) ────
echo "── 2. 다음 수업일에 다음 목차가 미리 들어오나 ──"
curl -s "localhost:4331/api/attendance?action=daily-rows&date=2026-10-16" -o /dev/null
NEXT=$($PS -d $DB -tAc "
  select (progress->'문법'->>'code')||' '||coalesce(progress->'문법'->>'title','')
  from daily_records where student_id='$SID' and date='2026-10-16'")
note "10/16 문법: $NEXT"
echo "$NEXT" | grep -q "^Unit 6" || bad "10/16 은 Unit 6 이어야 합니다 (받은 값: $NEXT)"

# ── 3. 미래 날짜는 저장하지 않나 (월말평가서 수업일수가 부풀면 안 됨) ────
echo "── 3. 미래 날짜는 행을 만들지 않나 ──"
BEFORE=$($PS -d $DB -tAc "select count(*) from daily_records where student_id='$SID'")
curl -s "localhost:4331/api/attendance?action=daily-rows&date=2026-12-21" -o /dev/null
AFTER=$($PS -d $DB -tAc "select count(*) from daily_records where student_id='$SID'")
note "미래 날짜 조회 전 $BEFORE 행 → 조회 후 $AFTER 행"
[ "$BEFORE" = "$AFTER" ] || bad "미래 날짜를 열어보기만 했는데 행이 생겼습니다 (수업일수가 부풀어 학부모에게 틀린 숫자가 나갑니다)"

# ── 3-2. 목차 경계 동작 (끝에서 멈춤 · 수기 진도 인식 등) ────────────────
echo "── 3-2. 목차 경계 동작 ──"
node "$HERE/progress-unit.mjs" 2>&1 | sed 's/^/  /'
[ ${PIPESTATUS[0]:-0} -eq 0 ] || bad "경계 동작 점검 실패 (위 참고)"

# ── 4. 샘플 SQL 을 돌렸을 때 진도가 거꾸로 가는 행이 없나 ─────────────────
#     (test_5/test_1 이 오늘 진도를 고정값으로 넣던 문제 — 2026-10-15 수정)
echo "── 4. 샘플 SQL 을 돌려도 진도가 거꾸로 안 가나 ──"
for order in "test_5_demo_students test_1_today test_3_month" "test_3_month test_5_demo_students test_1_today"; do
  $PS -q -c "drop database if exists ${DB}2" -c "create database ${DB}2" >/dev/null 2>&1
  $PS -d ${DB}2 -q -c "create role service_role nologin" -c "create extension if not exists pgcrypto" >/dev/null 2>&1
  $PS -d ${DB}2 -q -v ON_ERROR_STOP=1 -f "$APP/sql/setup.sql" >/dev/null 2>&1
  for f in $order; do
    $PS -d ${DB}2 -q -v ON_ERROR_STOP=1 -f "$APP/sql/$f.sql" >/dev/null 2>&1
  done
  BACK=$($PS -d ${DB}2 -tAc "
    with t as (
      select d.date, d.progress->'문법'->>'code' as c,
             lag(d.progress->'문법'->>'code') over (partition by d.student_id order by d.date) as p
      from daily_records d)
    select count(*) from t
    where date=(now() at time zone 'Asia/Seoul')::date and p is not null
      and nullif(regexp_replace(c,'\D','','g'),'')::int < nullif(regexp_replace(p,'\D','','g'),'')::int")
  note "순서 [$(echo $order | sed 's/ / -> /g')] 거꾸로 가는 행: $BACK"
  [ "$BACK" = "0" ] || bad "진도가 거꾸로 가는 행이 $BACK 개 있습니다"
done

(fuser -k 4331/tcp >/dev/null 2>&1 || true)
$PS -q -c "drop database if exists $DB" -c "drop database if exists ${DB}2" >/dev/null 2>&1

echo
[ $FAIL -eq 0 ] && echo "✅ 진도 점검 통과" || echo "❌ 진도 점검 실패 — 위 ❌ 줄을 보세요"
exit $FAIL
