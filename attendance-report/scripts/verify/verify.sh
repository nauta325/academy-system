#!/bin/bash
# attendance-report 전면 검수 — 매번 깨끗한 DB에서 처음부터.
set -u
set +m   # 백그라운드 서버를 죽일 때 "Killed" 알림이 뜨지 않게 (수강생이 오류로 오해함)
HERE="$(cd "$(dirname "$0")" && pwd)"   # 검수 스크립트 폴더
APP="$(cd "$HERE/../.." && pwd)"        # attendance-report 루트
cd "$HERE"
PS="psql -h /tmp -p 5433 -U postgres"

# 검수용 패키지(앱 배포와 무관 — 이 폴더에만 설치)
if [ ! -d node_modules ]; then
  echo "── 검수용 패키지 설치 (처음 한 번) ──"
  npm i --silent --no-audit --no-fund >/dev/null 2>&1 || { echo "❌ npm 설치 실패"; exit 1; }
fi

# 테스트용 PostgreSQL 이 떠 있는지 먼저 확인 (안 떠 있으면 setup.sql 오류로 오인됨)
if ! $PS -tAc "select 1" >/dev/null 2>&1; then
  cat <<'MSG'
❌ 테스트용 PostgreSQL(5433)이 안 떠 있습니다. 아래로 먼저 띄우세요.

  PGDATA=/tmp/pgtest
  rm -rf $PGDATA && mkdir -p $PGDATA && chown postgres:postgres $PGDATA
  su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/initdb -D $PGDATA -A trust -U postgres"
  su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/pg_ctl -D $PGDATA -o '-p 5433 -k /tmp' -l $PGDATA/log start"

(설치가 안 돼 있으면: apt-get install -y postgresql)
MSG
  exit 1
fi

echo "── 0. 깨끗한 DB 만들기 ──"
$PS -q -c "drop database if exists tapp" -c "create database tapp" >/dev/null 2>&1
$PS -d tapp -q -c "create role service_role nologin" -c "create extension if not exists pgcrypto" >/dev/null 2>&1
ERR=$($PS -d tapp -v ON_ERROR_STOP=1 -q -f "$APP/sql/setup.sql" 2>&1 | grep -i error | head -3)
if [ -n "$ERR" ]; then echo "❌ setup.sql 오류:"; echo "$ERR"; exit 1; fi
echo "  setup.sql OK"

echo "── 1. 스키마 ↔ 코드 컬럼 대조 ──"
TESTDB=tapp node audit-schema.mjs > /tmp/schema.out 2>&1; S=$?; tail -3 /tmp/schema.out
[ $S -ne 0 ] && echo "  ⚠️ 스키마 대조 실패 (위 내용 확인)"

echo "── 2. 서버 기동 (진짜 PostgreSQL) ──"
(fuser -k 4330/tcp 2>/dev/null || true); sleep 1
TESTDB=tapp nohup node app-server.mjs > app.log 2>&1 < /dev/null &
disown 2>/dev/null || true
sleep 3
curl -s -o /dev/null -w "  서버 %{http_code}\n" localhost:4330/

echo "── 3. API 전수 검사 ──"
node e2e-api.mjs > /tmp/e2e.out 2>&1; A=$?; tail -4 /tmp/e2e.out

echo "── 3-2. 노션 이관 (가짜 노션) ──"
(fuser -k 4330/tcp 2>/dev/null || true); sleep 1
MOCK_NOTION=1 TESTDB=tapp NOTION_TOKEN=secret_fake \
  NOTION_STUDENTS_DB=db-stu NOTION_DAILY_DB=db-daily NOTION_TEXTBOOKS_DB=db-book \
  NOTION_REPORTS_DB=db-report NOTION_COMMENTS_DB=db-comment \
  nohup node app-server.mjs > app.log 2>&1 < /dev/null &
disown 2>/dev/null || true
sleep 3
node notion-check.mjs > /tmp/notion.out 2>&1; N=$?; tail -4 /tmp/notion.out
# 노션 환경변수 없는 평소 상태로 되돌려 다음 단계 진행
(fuser -k 4330/tcp 2>/dev/null || true); sleep 1
TESTDB=tapp nohup node app-server.mjs > app.log 2>&1 < /dev/null &
disown 2>/dev/null || true
sleep 3

echo "── 4. 브라우저에서 전 화면 ──"
if [ -f browser-check.mjs ]; then node browser-check.mjs > /tmp/br.out 2>&1; B=$?; tail -4 /tmp/br.out; else echo "  (생략)"; B=0; fi

echo "── 5. 단위 점검 ──"
(cd "$APP" && node scripts/smoke-test.mjs > /tmp/smoke.out 2>&1); U=$?
grep -E "^FAIL|실패|통과" /tmp/smoke.out | tail -8
(cd "$APP" && node scripts/check-personal.mjs > /tmp/pers.out 2>&1); P=$?; tail -1 /tmp/pers.out
# DB 에러가 수강생이 읽을 수 있는 말로 나오나 (리허설에서 날코드가 화면에 그대로 떴던 건)
node db-error-unit.mjs > /tmp/dberr.out 2>&1; D=$?; tail -1 /tmp/dberr.out

(fuser -k 4330/tcp 2>/dev/null || true)

# ── 판정: 다섯 단계를 모두 본다 ──
#  예전에는 $A(API)·$B(브라우저)만 봐서, 스키마 대조가 죽어도 단위 점검이 실패해도
#  "전면 검수 통과" 가 찍혔습니다. 한 번 그러고 나면 검수기를 믿을 수 없게 됩니다.
FAILED=""
[ $S -ne 0 ] && FAILED="$FAILED 스키마대조"
[ $A -ne 0 ] && FAILED="$FAILED API"
[ $B -ne 0 ] && FAILED="$FAILED 브라우저"
[ $N -ne 0 ] && FAILED="$FAILED 노션이관"
[ $U -ne 0 ] && FAILED="$FAILED 단위점검"
[ $P -ne 0 ] && FAILED="$FAILED 개인정보"
[ $D -ne 0 ] && FAILED="$FAILED DB에러문구"
if [ -z "$FAILED" ]; then
  echo "
✅ 전면 검수 통과"
  exit 0
else
  echo "
❌ 검수 실패 —$FAILED
   자세한 내용: /tmp/schema.out · /tmp/notion.out · /tmp/e2e.out · /tmp/br.out · /tmp/smoke.out · /tmp/pers.out · /tmp/dberr.out"
  exit 1
fi
