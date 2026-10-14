-- ============================================================
-- [테스트 5] 데모용 가짜 학생 20명 + 오늘 다양한 상태
--   현황판이 꽉 차 보이게, 상태가 골고루 나오도록 오늘 기록까지 생성.
--   전부 가짜 이름/번호. 여러 번 돌려도 됩니다(pin 1001~1020 삭제 후 재생성).
--
--   상태 구성(현재 시각 기준):
--     수업중 5 · 곧 하원 3 · 하원 3 · 결석 2 · 지각 미등원 4 · 미등원 3
--   ※ 담당 선생님 3명(김선생/이선생/박선생) → 선생님 필터도 테스트됨
-- ============================================================

-- (재실행용) 데모 학생 삭제 — 기록도 cascade 삭제됨
delete from students where pin in (
  select lpad((1000+g)::text, 4, '0') from generate_series(1,20) g
);

-- 학생 20명 생성
with base as (
  select g,
    case when g between 14 and 17 then '09:00'   -- 이른 수업 → (기록 없으면) 지각 미등원
         when g between 18 and 20 then '22:00'   -- 늦은 수업 → (기록 없으면) 아직 예정 = 미등원
         else '15:00' end as tm
  from generate_series(1,20) g
)
insert into students (name, pin, phone, grade, teacher, class_minutes, status, schedule, books)
select
  (array['서지우','한도현','김하린','이준우','박서아','최민재','정예린','강시우','조하은','윤지호',
         '임수아','오재원','신유나','권태오','황지안','안소율','배현우','문채아','노건우','류지민'])[g],
  lpad((1000+g)::text, 4, '0'),
  '010-2000-' || lpad(g::text, 4, '0'),
  (array['초5','초6','중1','중2','중3'])[1 + (g % 5)],
  (array['김선생','이선생','박선생'])[1 + (g % 3)],
  (array[90,120,135,150])[1 + (g % 4)],
  '재원',
  jsonb_build_object('월',tm,'화',tm,'수',tm,'목',tm,'금',tm),
  (array[
    '{"문법":"그래머인유즈 1","리딩":"리딩릴레이 스타터1","단어":"능률 보카 기본"}',
    '{"문법":"그래머인유즈 2","리딩":"리딩릴레이 스타터2","단어":"능률 보카 실력"}',
    '{"문법":"초등 그래머","리딩":"주니어 리딩","단어":"초등 필수 단어"}'
  ]::jsonb[])[1 + (g % 3)]
from base;

-- 오늘 기록 — 상태가 골고루 보이게 (g 1~13만, 14~20은 기록 없음)
with kst as (select (now() at time zone 'Asia/Seoul') as t)
insert into daily_records
  (student_id, date, check_in, check_out, lateness, attitude, homework, voca_test, voca_score, progress, books)
select s.id, (now() at time zone 'Asia/Seoul')::date,
  case
    when gg.g between 1 and 5  then to_char(k.t - interval '30 min', 'HH24:MI')                       -- 수업중
    when gg.g between 6 and 8  then to_char(k.t - make_interval(mins => s.class_minutes - 5), 'HH24:MI') -- 곧 하원
    when gg.g between 9 and 11 then to_char(k.t - interval '3 hour', 'HH24:MI')                        -- 하원(등원시각)
  end,
  case when gg.g between 9 and 11 then to_char(k.t - interval '10 min', 'HH24:MI') end,               -- 하원시각
  case when gg.g between 12 and 13 then '결석' else '정시' end,
  case when gg.g % 4 = 0 then '중' else '상' end,
  case when gg.g % 6 = 0 then '중' else '상' end,
  case when gg.g between 12 and 13 then null when gg.g % 7 = 0 then '불통과' else '통과' end,
  -- 점수는 결과와 맞춰서 (불통과인데 20/20 이면 화면이 틀린 것처럼 보입니다)
  case when gg.g between 12 and 13 then null
       when gg.g % 7 = 0 then (10 + (gg.g % 4)) || '/20'
       else (16 + (gg.g % 5)) || '/20' end,
  jsonb_strip_nulls(jsonb_build_object(
    '문법', (select t.units -> 3 from textbooks t where t.name = s.books->>'문법'),
    '리딩', (select t.units -> 3 from textbooks t where t.name = s.books->>'리딩'),
    '단어', (select t.units -> 3 from textbooks t where t.name = s.books->>'단어')
  )),
  s.books
from students s
cross join kst k
join lateral (select (s.pin::int - 1000) as g) gg on true
where s.pin in (select lpad((1000+x)::text, 4, '0') from generate_series(1,13) x);

-- 확인
select count(*) as 데모학생수 from students where pin in (
  select lpad((1000+g)::text, 4, '0') from generate_series(1,20) g);
