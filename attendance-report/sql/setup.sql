-- ============================================================
-- 학원 자동화 (Vercel + Supabase 판) — 셋업 SQL
-- 2차 세미나(노션 + 앱스크립트)의 DB 속성을 그대로 이식 — 노션 데이터 이관 가능:
--   전체학생DB / 데일리리포트DB / 교재DB / 월말참고사항DB / 월말평가서DB
-- Supabase → SQL Editor 에 통째로 붙여넣고 Run 한 번이면 끝.
--
-- ⚠️ 실제 학생 이름·전화번호는 넣지 마세요. 아래 샘플은 전부 가짜입니다.
-- ============================================================

drop table if exists tasks cascade;
drop table if exists monthly_reports cascade;
drop table if exists monthly_comments cascade;
drop table if exists daily_records cascade;
drop table if exists textbooks cascade;
drop table if exists students cascade;

-- ── 전체학생DB ────────────────────────────────────────────
create table students (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,                -- 학생이름
  student_code  text,                         -- 학생ID (예: nauta01) — 노션 이관용
  pin           text,                         -- 출결PIN (키오스크 등·하원)
  phone         text,                         -- 전화번호 (학부모 알림톡용)
  grade         text,                         -- 학년 (예: 중2)
  teacher       text,                         -- 담당 선생님
  class_minutes int  not null default 120,    -- 수업시간(분) → 예상 하원시간 계산
  status        text not null default '재원',  -- 재원상태: 재원 / 퇴원
  -- 요일별 등원 예정시간 {"월":"17:00","화":"","수":"17:00",...} (빈값=그날 수업 없음)
  schedule      jsonb not null default '{}',
  -- 현재 교재(문법/리딩/단어 교재 Relation) {"문법":"...", "리딩":"...", "단어":"..."}
  books         jsonb not null default '{}',
  created_at    timestamptz not null default now()
);

-- ── 데일리리포트DB (매일 한 줄) ───────────────────────────
create table daily_records (
  id         uuid not null default gen_random_uuid() primary key,
  student_id uuid not null references students(id) on delete cascade, -- 학생이름 Relation
  date       date not null,                -- 날짜
  check_in   text,                         -- 실제 등원시간 HH:MM
  check_out  text,                         -- 실제 하원시간 HH:MM
  lateness   text,                         -- 지각: 정시등원 / 지각 / 결석
  attitude   text not null default '상',    -- 태도: 상 / 중 / 하
  homework   text not null default '상',    -- 과제: 100%완료 / 상 / 중 / 하
  voca_test  text,                         -- 단어테스트_결과: 통과 / 불통과
  voca_score text,                         -- 단어테스트 점수 (예: 18/20)
  -- 과목별 진도 {"문법":{"code":"Unit 5","title":"현재완료"}, ...}  (유닛 코드 + 실제 제목)
  progress   jsonb not null default '{}',
  -- 그날의 교재 스냅샷(학생DB에서 복사) {"문법":"교재명",...} — 교재 전환 감지용
  books      jsonb not null default '{}',
  note        text,                        -- 지적사항 (내부 기록, 학부모에게 안 나감)
  parent_note text,                        -- 추가사항 (데일리 리포트 카톡에 나가는 내용)
  kakao_sent  text not null default '미전송', -- 등원 알림톡 상태: 미전송/전송/실패
  report_sent text not null default '미전송', -- 데일리 리포트 카톡 상태
  created_at timestamptz not null default now(),
  unique (student_id, date)
);

-- ── 월말참고사항DB (선생님 코멘트) ────────────────────────
create table monthly_comments (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references students(id) on delete cascade, -- 학생 Relation
  month        text not null,               -- 연월 'YYYY-MM'
  comment      text,                        -- 참고사항
  middle_school boolean not null default false, -- 중학생(내신 대비)
  unique (student_id, month)
);

-- ── 월말평가서DB (AI 생성 결과) ───────────────────────────
create table monthly_reports (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  month       text not null,              -- 연월 'YYYY-MM'
  body        text,                       -- 평가서본문
  stats       jsonb not null default '{}',-- 수업일수/단어통과율/과제상비율/태도상비율 등
  progress    jsonb not null default '{}',-- 문법/리딩/단어 최종진도 {과목:{교재명,유닛코드,제목}}
  share_token text not null unique default replace(gen_random_uuid()::text, '-', ''), -- 열람링크 토큰
  kakao_sent  boolean not null default false, -- 카톡전송
  created_at  timestamptz not null default now(), -- 생성일
  updated_at  timestamptz not null default now(),
  unique (student_id, month)
);

-- ── 교재DB (교재비·재고 관리 + 목차/진도) ─────────────────
-- 2차: 교재명(제목)·종류·가격·수량·재고. 여기에 목차(units)+하루진도(step)를 더해 진도 자동화까지.
create table textbooks (
  id           uuid primary key default gen_random_uuid(),
  subject      text,                        -- 종류: 문법 / 리딩 / 단어
  name         text not null unique,        -- 교재명 (학생 books 값과 일치해야 연결됨)
  price        int,                         -- 가격
  stock_total  int,                         -- 누적 교재 수량
  distributed  int  not null default 0,     -- 배포된 수량 (재고 = 누적 - 배포)
  -- 목차 [{ "code":"Unit 1", "title":"be동사" }, ...] — 순서대로 진도 전환
  units        jsonb not null default '[]',
  step         int  not null default 1,     -- 하루(수업) 진도 = 넘길 유닛 수
  created_at   timestamptz not null default now()
);

-- ── 과제DB (학생앱 체크리스트) ────────────────────────────
-- 선생님이 내주고(teacher.html) 학생이 체크한다(student.html).
-- daily_records.homework 는 선생님이 매기는 '상/중/하' 한 칸이고, 이건 학생이 볼 '할 일 목록'.
create table tasks (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  date       date not null,                  -- 해야 하는 날
  kind       text not null default '집',      -- 학원 / 집
  subject    text,                           -- 과목 (선택 — 비워도 됨)
  title      text not null,                  -- 과제 내용 (예: "Unit 5 워크북 p.42~45")
  done       boolean not null default false, -- 학생이 체크했는지
  done_at    timestamptz,                    -- 체크한 시각
  created_at timestamptz not null default now()
);

create index on daily_records (date);
create index on daily_records (student_id, date);
create index on monthly_reports (month);
create index on tasks (student_id, date);
create index on tasks (date);

-- 모든 접근은 서버(api/*.js)가 service_role 키로 처리 → RLS on, 공개정책 없음(안전).
alter table students         enable row level security;
alter table daily_records    enable row level security;
alter table monthly_comments enable row level security;
alter table monthly_reports  enable row level security;
alter table textbooks        enable row level security;
alter table tasks            enable row level security;

-- ============================================================
-- ★ service_role 권한 부여 (이거 빠지면 세미나 당일 다 막힙니다)
--   실제 사고: 미니 원서 앱 세미나 때 이게 없어서 42501(permission denied)로
--   학생 로그인·관리자 화면이 전부 막혔습니다. 반드시 같이 돌아가야 합니다.
--   RLS 는 켜 두고(공개 정책 없음), 서버(api/*.js)만 service_role 로 접근합니다.
-- ============================================================
grant usage on schema public to service_role;
grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
-- 앞으로 만들 표에도 자동으로 권한이 붙게
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;


-- ============================================================
-- 샘플 데이터 (전부 가짜 이름). 붙여넣자마자 화면이 돕니다.
-- ============================================================
insert into students (name, student_code, pin, phone, grade, teacher, class_minutes, schedule, books) values
  ('김민준', 'demo01', '1111', '010-0000-0001', '중2', '이선생', 120,
   '{"월":"17:00","화":"","수":"17:00","목":"","금":"17:00"}',
   '{"문법":"그래머인유즈 1","리딩":"리딩릴레이 스타터1","단어":"능률 보카 기본"}'),
  ('이서연', 'demo02', '2222', '010-0000-0002', '중3', '이선생', 150,
   '{"월":"18:00","화":"18:00","수":"","목":"18:00","금":""}',
   '{"문법":"그래머인유즈 2","리딩":"리딩릴레이 스타터2","단어":"능률 보카 실력"}'),
  ('박도윤', 'demo03', '3333', '010-0000-0003', '초6', '박선생', 90,
   '{"월":"16:00","화":"","수":"16:00","목":"","금":"16:00"}',
   '{"문법":"초등 그래머","리딩":"주니어 리딩","단어":"초등 필수 단어"}');

-- 교재DB — 목차는 {code(유닛번호), title(실제 제목)} (코드와 제목이 다름을 보여줌) + 가격/수량
insert into textbooks (subject, name, price, stock_total, distributed, units) values
  ('문법','그래머인유즈 1', 15000, 30, 12, '[{"code":"Unit 1","title":"be동사"},{"code":"Unit 2","title":"일반동사"},{"code":"Unit 3","title":"현재진행"},{"code":"Unit 4","title":"과거시제"},{"code":"Unit 5","title":"현재완료"},{"code":"Unit 6","title":"조동사"},{"code":"Unit 7","title":"수동태"},{"code":"Unit 8","title":"비교급과 최상급"}]'),
  ('리딩','리딩릴레이 스타터1', 14000, 30, 12, '[{"code":"Unit 1","title":"My Family"},{"code":"Unit 2","title":"School Life"},{"code":"Unit 3","title":"Animals"},{"code":"Unit 4","title":"Food"},{"code":"Unit 5","title":"Seasons"},{"code":"Unit 6","title":"Hobbies"}]'),
  ('단어','능률 보카 기본', 12000, 30, 12, '[{"code":"Day 1-10","title":"기초 어휘"},{"code":"Day 11-20","title":"학교·가족"},{"code":"Day 21-30","title":"자연·동물"},{"code":"Day 31-40","title":"감정·성격"},{"code":"Day 41-50","title":"여행·음식"}]'),
  ('문법','그래머인유즈 2', 16000, 20, 8, '[{"code":"Unit 1","title":"시제 종합"},{"code":"Unit 2","title":"완료시제"},{"code":"Unit 3","title":"조동사 심화"},{"code":"Unit 4","title":"수동태"},{"code":"Unit 5","title":"관계사"},{"code":"Unit 6","title":"분사"}]'),
  ('리딩','리딩릴레이 스타터2', 14000, 20, 8, '[{"code":"Unit 1","title":"City Life"},{"code":"Unit 2","title":"Science"},{"code":"Unit 3","title":"History"},{"code":"Unit 4","title":"Sports"},{"code":"Unit 5","title":"Culture"},{"code":"Unit 6","title":"Future"}]'),
  ('단어','능률 보카 실력', 13000, 20, 8, '[{"code":"Day 1-10","title":"학업 어휘"},{"code":"Day 11-20","title":"사회·경제"},{"code":"Day 21-30","title":"과학·기술"},{"code":"Day 31-40","title":"예술·문화"},{"code":"Day 41-50","title":"추상 개념"}]'),
  ('문법','초등 그래머', 11000, 25, 10, '[{"code":"1과","title":"명사"},{"code":"2과","title":"대명사"},{"code":"3과","title":"be동사"},{"code":"4과","title":"일반동사"},{"code":"5과","title":"현재시제"},{"code":"6과","title":"과거시제"}]'),
  ('리딩','주니어 리딩', 10000, 25, 10, '[{"code":"1과","title":"Pets"},{"code":"2과","title":"My Day"},{"code":"3과","title":"Colors"},{"code":"4과","title":"Numbers"},{"code":"5과","title":"Weather"}]'),
  ('단어','초등 필수 단어', 9000, 25, 10, '[{"code":"1주차","title":"학교 생활"},{"code":"2주차","title":"집·가족"},{"code":"3주차","title":"동물·자연"},{"code":"4주차","title":"놀이·취미"}]');

-- 2026-05 평일 데일리리포트 (완료된 과거 데이터 → 월말평가서 데모)
--   진도는 교재 목차에서 뽑아 {code,title} 통째로 저장 · 교재 스냅샷(books)도 함께
insert into daily_records (student_id, date, check_in, check_out, lateness, attitude, homework, voca_test, voca_score, progress, books)
select
  s.id, d::date,
  '17:0' || (rn % 6), '19:0' || (rn % 6),
  case when rn % 9 = 0 then '결석' when rn % 5 = 0 then '지각' else '정시등원' end,
  case when rn % 4 = 0 then '중' else '상' end,
  case when rn % 6 = 0 then '중' else '100%완료' end,
  case when rn % 9 = 0 then null when rn % 7 = 0 then '불통과' else '통과' end,
  case when rn % 9 = 0 then null else (16 + (rn % 5)) || '/20' end,
  jsonb_strip_nulls(jsonb_build_object(
    '문법', (select t.units -> (case when extract(day from d) <= 15 then 1 else 2 end) from textbooks t where t.name = s.books->>'문법'),
    '리딩', (select t.units -> (case when extract(day from d) <= 15 then 1 else 2 end) from textbooks t where t.name = s.books->>'리딩'),
    '단어', (select t.units -> (case when extract(day from d) <= 15 then 1 else 2 end) from textbooks t where t.name = s.books->>'단어')
  )),
  s.books
from students s
cross join lateral (
  select d, row_number() over (order by d) as rn
  from generate_series('2026-05-01'::date, '2026-05-31'::date, '1 day') g(d)
  where extract(dow from d) between 1 and 5
) days;

-- 오늘자 데일리리포트 (출결현황판/키오스크 데모 — 아직 등원 전, 진도는 다음 유닛)
insert into daily_records (student_id, date, progress, books)
select s.id, current_date,
  jsonb_strip_nulls(jsonb_build_object(
    '문법', (select t.units -> 3 from textbooks t where t.name = s.books->>'문법'),
    '리딩', (select t.units -> 3 from textbooks t where t.name = s.books->>'리딩'),
    '단어', (select t.units -> 3 from textbooks t where t.name = s.books->>'단어')
  )), s.books
from students s;

-- 오늘 과제 (학생앱 데모 — 로그인하면 바로 체크할 게 보이도록)
--   학생 로그인은 student_code + pin (예: demo01 / 1111)
insert into tasks (student_id, date, kind, subject, title, done)
select s.id, current_date, v.kind, v.subject,
  -- 진도에서 유닛 코드를 끌어와 과제 제목을 만든다 (교재 목차 → 과제까지 이어지는 흐름 데모)
  v.prefix || coalesce((select r.progress -> v.subject ->> 'code'
                        from daily_records r where r.student_id = s.id and r.date = current_date), '') || v.suffix,
  v.done
from students s
cross join (values
  ('학원', '문법', '문법 워크북 ',  ' 풀기',        false),
  ('집',   '단어', '단어 ',         ' 외우고 자기테스트', false),
  ('집',   '리딩', '리딩 ',         ' 소리내어 2번 읽기', true)
) as v(kind, subject, prefix, suffix, done);

insert into monthly_comments (student_id, month, comment, middle_school)
select id, '2026-05',
  case name
    when '김민준' then '단어 재시험이 몇 번 있었지만 끝까지 통과. 발표에 적극적.'
    when '이서연' then '리딩 속도가 눈에 띄게 빨라짐. 숙제 성실.'
    else '결석 없이 성실하게 다니고 수업 태도가 좋음.'
  end,
  case when grade like '중%' then true else false end
from students;
