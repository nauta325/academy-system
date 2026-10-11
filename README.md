# 🏫 올인원 학원 시스템 (academy-system)

출결 · **데일리리포트** · **AI 월말평가서** · **학생앱** · **선생님앱** 을
터미널 없이 **브라우저만으로** 배포하고, **클로드에게 말해서 고치는** 학원 운영 시스템입니다.
**Vercel + Supabase (+ Claude, 솔라피)** 만 씁니다.

> 🧑‍🏫 **세미나 수강생이라면** — 자료실과 교재를 먼저 보세요.
> 여기 코드는 **「Use this template」로 내 저장소에 복제**해서 쓰는 게 시작입니다.

---

## 무엇이 되나

| 기능 | 화면 | 하는 일 |
|---|---|---|
| **데일리 리포트** ★ | `/daily.html` | 오늘 등원 판단 → **다음 진도가 이미 채워진** 리포트 생성 → 태도·과제 작성(자동 저장) → 📨 학부모 카톡 |
| **월말평가서** ★ | `/report.html` → `/parent.html` | 한 달 집계 + Claude가 본문 작성 → 그래프 4종 → 학부모는 PIN으로 열람 |
| **교재 · 목차** ★ | `/books.html` | **목차를 한 번 넣으면 진도가 매일 자동으로 넘어갑니다** — 손으로 안 씁니다 |
| 출석 현황판 | `/board.html` | 등원·곧 하원·미등원·하원 실시간 + 미등원 알림톡 |
| 출결 키오스크 | `/kiosk.html` | PIN 4자리 등·하원, 지각 자동 판정 |
| **선생님앱** | `/teacher.html` | **내 담당 학생만** + 과제 내주기(오늘 진도로 자동 채우기) |
| **학생앱** | `/student.html` | 학생이 **폰으로** 로그인 → 과제 체크 · 내 진도 · 월말평가서 |
| 노션 불러오기 | `/import.html` | 기존 노션(학생·데일리·교재·월말) 데이터 이관 |

---

## 🚀 시작 (브라우저만, 약 15분)

### 1) 내 저장소 만들기
이 페이지 오른쪽 위 **`Use this template` → `Create a new repository`**
→ 내 계정에 복사본이 생깁니다. (버튼이 안 보이면 GitHub **로그인** 먼저, 그래도 없으면 **Fork**)

### 2) Supabase (데이터베이스)
1. [supabase.com](https://supabase.com) → 새 프로젝트 (리전 **Northeast Asia (Seoul)** 권장)
2. **SQL Editor** → `attendance-report/sql/setup.sql` 전체 붙여넣고 **Run**
   → 표 6개 + 가짜 샘플이 한 번에 생깁니다
3. **Settings → API** 에서 복사: `Project URL`, `service_role` 키
   (⚠️ `service_role` 은 비밀키입니다. 화면·채팅에 노출하지 마세요)

### 3) Vercel (배포)
1. [vercel.com](https://vercel.com) → **Add New → Project** → 1)의 저장소 Import
2. ⚠️ **Root Directory 를 `attendance-report` 로 지정** ← **안 하면 전 화면 404**
3. **Environment Variables** 입력 → **Deploy**

| 변수 | 값 | |
|---|---|---|
| `SUPABASE_URL` | Project URL | ✅ 필수 |
| `SUPABASE_SERVICE_KEY` | service_role 키 | ✅ 필수 |
| `ANTHROPIC_API_KEY` | Claude 키 | 월말평가서 본문 |
| `ACADEMY_NAME` / `BRAND_COLOR` | 학원 이름 · 대표 색 | 선택 |
| `SOLAPI_*` / `TPL_*` | 알림톡(5종) | 선택 |
| `NOTION_*` | 노션 이관 | 선택 |

4. `https://내프로젝트.vercel.app/` 접속 → 홈에서 각 화면 확인 ✅

> 환경변수를 추가·수정하면 **Deployments → Redeploy** 를 눌러야 적용됩니다.
> 그리고 **Production 주소**로 테스트하세요(Preview 주소엔 환경변수가 안 붙습니다).

### 4) 내 학원으로
- `/students.html` → 샘플 3명 지우고 **내 학생** 붙여넣기 일괄등록
  (⚠️ **학생ID·출결PIN·담당 선생님**을 꼭 채우세요 — 학생앱 로그인과 선생님앱 범위에 씁니다)
- `/books.html` → **교재 목차**를 `유닛코드 | 제목` 으로 한 줄씩
  (⚠️ 교재명은 학생에게 지정한 교재명과 **글자까지 같아야** 연결됩니다)

---

## ⚠️ 이미 데이터를 넣은 뒤라면

`sql/setup.sql` 은 맨 앞에서 **표를 지우고** 다시 만듭니다.
**두 번 돌리지 마세요.** 표를 추가해야 하면 마이그레이션만 Run 하세요.

- `sql/migrate_daily_report.sql` — 2차 세미나 DB 속성 반영
- `sql/migrate_tasks.sql` — 학생앱 과제 표 추가 (+ 학생ID·PIN·담당이 빈 학생 점검)

---

## 🗣️ 바이브 코딩 — 말해서 고치기

코드를 열지 않습니다. 클로드에게 이렇게 말하면 됩니다.

```
config.js 에서 학원 이름을 "○○영어학원"으로, 대표 색을 남색으로 바꿔줘.
```
```
학생앱(student.html)에서 과제를 다 체크하면 축하 메시지랑 별 스티커가 뜨게 해줘.
```
```
단어테스트 결과가 비어 있으면 단어 진도를 넘기지 말고 같은 유닛으로 둬.
lib/progress.js 의 advanceProgress() 를 고치면 될 거야.
```
```
이 에러 원인 찾아서 고쳐줘: <에러 화면 붙여넣기>
```

어디를 고치면 되는지는 **`attendance-report/CLAUDE.md`** 에 정리돼 있습니다.
클로드가 그 파일을 먼저 읽고 작업합니다.

---

## 🧪 자체 점검

```bash
cd attendance-report
node scripts/smoke-test.mjs      # 로직 점검 (DB 없이 돌아감)
node scripts/check-personal.mjs  # 커밋 전 개인정보·실키 점검
bash scripts/verify/verify.sh    # (선택) 진짜 DB+브라우저로 전 구간 검수
```

---

## 규칙 (★)

- **`service_role` 키를 HTML·브라우저로 내보내지 마세요.** DB 접근은 `api/*.js`(서버)에서만.
- **`api/student.js` 의 `student_id=eq.` 조건을 지우지 마세요** — 학생이 '자기 것만' 보게 막는 장치입니다.
- **실제 학생 이름·전화번호·API 키를 커밋하지 마세요.** 샘플은 전부 가짜입니다.
- 알림톡 변수명(`#{학생이름}` `#{리딩교재}` …)은 1·2차 세미나 템플릿과 맞춰져 있습니다. 추가는 괜찮지만 바꾸면 기존 템플릿이 안 나갑니다.

---

<sub>🏫 HongLab · 세미나 실습 템플릿 · 문의는 수강생 단톡방으로</sub>
