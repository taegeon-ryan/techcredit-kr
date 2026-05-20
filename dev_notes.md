# 개발 노트 — 조세특례제한법 시행령 기술 목록 파싱 자동화

---

## 2026-04-21

**지시사항**: 조세특례제한법 시행령 [별표 7의2] 국가전략기술, [별표 7] 신성장·원천기술 PDF를 파싱해 CSV로 변환 (pdfplumber 사용).

**문제 및 개선**: PDF 특성상 페이지 경계에서 셀 내용이 잘리는 문제로 소분야명이 깨지는 현상 발생. `flush()` 타이밍 버그(소분야가 잘못 귀속)도 수정. 행 수 불일치(296 vs 302) 조사 결과 문서 자체가 296개 항목임을 번호 연속성으로 확인.

**결과물**: `국가전략기술_260227.csv` (81행), `신성장원천기술_260227.csv` (296행)

---

## 2026-04-22

HWPX 기반 파서 재작성 — PDF 페이지 분할 문제 해소. CSV 2종 재생성.

---

## 2026-04-23

CSV 4종 기반 기술현황 대시보드 구축 (Vite + React 19, Recharts, PapaParse). 카드뷰·통계 차트·기술 목록 테이블 구현. 현행 기술: 신성장·원천 284건, 국가전략 81건.

---

## 2026-04-24

대시보드 UI 개선 — 통계 차트(연도별 보조선, 분야별 이모지 아이콘, 툴팁 포맷), 카드뷰 레이아웃(기술 수 우측 정렬, 반응형 그리드, 분야 재번호) 등.

---

## 2026-04-29

GitHub 푸시 및 Vercel 배포. Root Directory를 `dashboard`로 지정, Framework Preset `Vite` 수동 선택. 사이트 제목·파비콘 통일 (PR #5).

---

## 2026-05-07

세부기술 페이지 적용시기·사업화시설 표기 개선(PR #6). 적용일→적용시기 라벨 변경 및 경과기간 배지 추가, 분야 공통 시설 매칭 로직 정비. 분야 기술 목록에 도입 기간 필터·정렬 옵션·폐지 포함 토글과 최초 도입시기 태그 도입.

---

## 2026-05-08

세부기술 변경 연혁 diff(`diffWords`) 기능 도입 및 연관 기술 추천/표시 PR. 변경 연혁 표기·폐지 항목·전면개정 정리, 적용시기 기준을 최초 신설일(`first_apply_date`)로 통일, 유사도 산식을 토큰 Dice로 개선. 지능정보·국가전략 반도체 사업화시설 매칭 오탐 수정과 기술 목록 컨트롤 상태 유지 처리.

---

## 2026-05-11

대시보드 탐색·연혁·연관 기술 UX 개선. 변경 연혁을 `연혁 보기` 토글로 정리하고 유사도 산식을 토큰 Dice + 문자 바이그램으로 보강. 세부기술/분야 이전·다음 페이저 추가, `useNavigationHistory` 훅으로 뒤로가기·BFCache·스크롤 복원 처리.

## 2026-05-12

**연관 기술 명시 매핑 기능 구현**:
- 자동 유사도 추천으로 잡히지 않는 연관 기술을 사람이 CSV로 지정할 수 있도록 `input/manual_relations.csv` 원본과 `dashboard/public/data/manual_relations.csv` 배포 사본을 추가
- CSV 스키마는 `id, strategic_sector, strategic_apply_date, strategic_tech_name, newgrowth_sector, newgrowth_subsector, newgrowth_apply_date, newgrowth_tech_name` 형식으로 단순화
- `dashboard/src/utils/manualRelations.js`에서 최초 도입 스냅샷(`전략 분야 + 적용일 + 기술명`, `신성장 분야 + 소분야 + 적용일 + 기술명`)을 현행 기술 행으로 해석하고, 한 줄의 관계를 양방향 `manualMatches`로 병합
- 세부기술 상세의 연관 기술 표시 순서를 `정확 일치 → 명시 매핑 → 유사 매칭 → 승격 이력`으로 확장하고, 명시 매핑은 유사도 하이라이트 없이 일반 카드로 표시
- `dashboard/package.json`의 `prebuild` 훅에서 `input/manual_relations.csv`를 `dashboard/public/data/manual_relations.csv`로 자동 복사하도록 `sync:relations` 스크립트 추가. 수동 관계를 수정할 때는 `input/manual_relations.csv`만 편집하면 빌드 시 배포 사본이 갱신됨

**사업화시설·승격 이력 매칭 보정**:
- 사업화시설 매칭에서 `기능개선`, `이하 이 호에서 같다`, 괄호 안 영문 풀네임처럼 기술표와 시설표 사이에만 다른 법령 문구를 좁게 정규화해 AMOLED·바이오 신약 시설 누락을 수정
- 폐지된 신성장 기술이 국가전략기술로 승격되며 기술명이 확장된 경우도 유사도 기준으로 승격 이력을 표시하도록 보완
- 번호 이동 후 최종 폐지된 동일 기술/시설이 `current=True`로 중복 남는 문제를 파서 단계에서 보정해, 같은 `분야 + 소분류 + 기술명`의 현행 폐지행은 최신 폐지행만 current로 유지
- 검증: `전기동력 자동차의 전력변환 및 충전 시스템 기술`의 신성장 현행 폐지 중복 0건, 승격 연관 1건 유지, `npm run lint`, `npm run build` 통과

**탐색·레이아웃 정리**:
- 세부기술 이전/다음 이동 후 상단의 `분야 목록`, `기술 목록` 버튼이 브라우저 뒤로가기처럼 동작하던 문제를 직접 목록 상태로 이동하도록 수정
- 분야 카드 그리드를 폭 증가에 따라 `2 → 3 → 4`열로 자연스럽게 전환되도록 고정하고, 3열 전환 폭을 넓혀 카드 흐름을 정리
- Vite 개발 서버를 5173 포트 고정(`strictPort`)으로 설정하고, `AGENTS.md`에 5173 포트만 사용하도록 기록

**다크모드 구현**:
- `useTheme` 훅과 FOUC 방지 인라인 스크립트를 추가해 `localStorage` 저장값을 우선 적용하고, 저장값이 없으면 OS `prefers-color-scheme`을 초기값으로 사용
- 헤더 색을 slate-700 계열로 밝히고, 다크모드에서는 기존 진한 남색을 본문 배경으로 재활용하도록 CSS 변수 체계를 확장
- 헤더 제목 옆(데스크탑)과 기술 개수 오른쪽(모바일)에 해/달 원형 토글을 배치하고, 카드·검색·목록·상세·연혁·연관 기술·사업화시설·통계 차트 색상을 테마 변수 기반으로 정리
- 세부기술 상세의 기술·사업화시설 `연혁 보기` 버튼에 닫힌 상태의 연혁 개수를 함께 표시
- 검증: `npm run lint`, `npm run build`, 5173 개발 서버 브라우저 확인(데스크탑/모바일 토글, 새로고침 유지, 통계·목록·상세·연혁 다크 화면) 통과

**과학기술 용어 글로서리(쉽게 설명하기) 1차 구현**:
- 매 조회마다 LLM API를 부르는 대신, 빌드 타임에 한 번 생성한 정적 JSON(`dashboard/public/data/glossary.json`)을 본문 텍스트에 매칭해 점선 밑줄 + hover/tap 팝오버로 보여주는 방식 채택
- 추출 파이프라인: `scripts/extract_terms.mjs`가 4개 CSV의 `tech_name`/`tech_description`/`facility_description`에서 영문 약자(블록리스트로 단위·일반 약어 제외), `한글(영문)` / `영문(한글)` 괄호 페어, `input/glossary_seed.txt`의 한글 시드를 끌어모아 `input/glossary_candidates.json`(393개)을 빈도순으로 생성. 각 후보에 `dominantSector`(등장 행의 sector_name 빈도 1위)와 매핑된 `domain`/`domainCandidates`, sampleContexts(±40자 ×3)를 동봉
- 도메인 매핑: `input/sector_domains.json`에서 sector_name 36개를 짧은 라벨로 매핑. 값에 문자열 1개 또는 배열을 둘 수 있어, "차세대 전자정보 디바이스"처럼 한 분야에 반도체·디스플레이·전자가 섞인 경우 LLM이 sampleContexts 보고 라벨 1개를 선택
- LLM 워크플로우(API 비사용): `scripts/chunk_candidates.mjs`가 후보를 20개씩 잘라 `input/candidate_chunks/01~20.json`으로 저장, 운영자가 [scripts/prompts/glossary_generation.md](scripts/prompts/glossary_generation.md) 프롬프트와 함께 Claude/ChatGPT/Gemini로 분담 실행. 응답을 `input/glossary_batches/NN.json`에 저장 후 `scripts/merge_glossary.mjs`가 dedup·conflict 보고하며 `input/glossary_source.json`으로 머지. `dashboard/scripts/copyGlossary.js`가 `predev`/`prebuild`에서 `dashboard/public/data/glossary.json`으로 자동 동기화
- 런타임: `useGlossary` 훅이 글로서리 fetch, `glossaryMatcher.js`가 길이 내림차순 + ASCII(case-insensitive `\b`경계) / 한글(조사 무시) 두 정규식으로 토큰화, `GlossarizedText`가 텍스트→토큰, `TermPopover`가 단일 인스턴스 portal 팝오버(데스크탑 hover/focus, 모바일 tap, ESC·외부 클릭 닫힘, viewport flip)를 그림. 적용 지점은 `TechDetail.jsx`의 `tech_description`(551행)과 `facility_description`(690행) 두 곳 (`tech_name`/연혁 diff는 보류)
- 팝오버 구성: 제목 + 도메인 배지 + aliases 라인(풀네임·한글 직역 분리 노출) + short 본문 + 점선 구분선 아래 "AI가 생성한 설명으로, 일부 불확실한 정보가 포함될 수 있습니다." 고지. 다크모드 시인성을 위해 `--term-underline`/`--term-popover-*` CSS 변수를 light/dark 양쪽 정의
- 시드 글로서리는 LLM 출력 후 검수까지 진행해 18개→373개로 확장. 본문 첫 문장에 풀네임을 반복하지 않도록 프롬프트에 명시(aliases 라인이 같은 정보를 보여 줌)
- 검증: `npm run lint`, `npm run build`, 5173 dev 서버 브라우저(데스크탑 hover/focus·라이트/다크 모드에서 "원자층증착법(ALD)…" 및 "AMOLED 패널…" 세부기술 본문의 점선 밑줄·팝오버·고지 표시) 통과

---

## 2026-05-13

**글로서리 파이프라인 재구축 (사용자 큐레이션 기반)**:
- 기존 자동 추출(`extract_terms.mjs`)이 일반 약어/단위/노이즈를 광범위하게 떨어뜨려 후처리 부담이 컸음. 사용자가 직접 본문을 읽고 채워 넣는 **워크북 방식**으로 전환
- 새 스크립트 4종(`scripts/build_term_workbook.mjs`, `normalize_terms.mjs`, `chunk_terms.mjs`, `merge_glossary.mjs`)과 새 프롬프트(`scripts/prompts/glossary_generation.md`). 공통 CSV I/O는 `scripts/_csv.mjs` 로 분리
- 1단계: `build_term_workbook.mjs` 가 `output/strategic_tech.csv`·`newgrowth_tech.csv` 의 **현행+폐지 459건**(`current=True`)만 추려 `input/term_workbook_reference.csv`(읽기 전용)와 빈 `input/term_workbook.csv`(`term, domain, note`) 생성. 기존 사용자 입력 보존
- 2단계: `normalize_terms.mjs` 가 워크북을 읽어 동일 도메인 내 표기 정규화(대소문자/공백/하이픈/중점 제거 키) → 클러스터링. canonical 선정 규칙은 **본문에 "한글(영문)" 페어로 등장하면 한글 우선, 아니면 영어 약어 우선**. 등장 컨텍스트(±40자 3개)와 sourceTechs(전략/신성장 어디서 등장)를 자동 부착해 `input/term_candidates.json` 생성
- 3단계: `chunk_terms.mjs` 가 20개씩 `input/term_chunks/NN.json` 분할 → LLM 응답을 `input/term_batches/NN.json` 에 저장
- 4단계: `merge_glossary.mjs` 가 배치를 합쳐 **단일 `input/glossary.csv`**(컬럼: `term, aliases, domain, short, related`, 리스트는 `;` 구분) 생성. 운영자가 수기 정정 가능한 표 형식
- 5단계: `dashboard/scripts/copyGlossary.js` 가 `predev`/`prebuild` 에서 CSV → `dashboard/public/data/glossary.json` 으로 변환(대시보드는 JSON 로딩 유지)
- 제거된 자산: `scripts/extract_terms.mjs`, `scripts/chunk_candidates.mjs`, 기존 `scripts/merge_glossary.mjs`, `input/glossary_seed.txt`, `input/glossary_candidates.json`, `input/glossary_batches/`, `input/candidate_chunks/`, `input/glossary_source.json`, `input/sector_domains.json`

**사업화시설 글로서리 적용 제약**:
- 사업화시설 본문에 글로서리가 무차별 적용되어 시설 고유 단어가 과도하게 하이라이트되던 문제. **같은 기술 본문(`tech_description`)에 등장한 용어만 facility 에 적용**하도록 변경
- 구현: `dashboard/src/hooks/useGlossaryEntries.js` 훅이 기술 본문에서 매칭되는 term canonical 문자열 Set 을 반환 → `GlossarizedText` 에 `restrictTo` prop 추가. `useGlossary` 가 컴포넌트별로 독립 fetch 되어 entry 객체 identity 가 어긋나는 문제 때문에 entry 객체 reference 가 아닌 **`term.term` 문자열 키**로 비교
- 연혁(`history-block`)은 그대로 미적용 — 기존 동작 유지

**모바일 팝오버 두 버그 수정 (`TermPopover.jsx`)**:
- "두 번 터치해야 설명이 나오는 문제": no-hover 환경에서 `tabIndex=0` 으로 인해 첫 탭에 `onFocus` 가 먼저 팝오버를 열고 직후 `onClick` 이 `isOpen=true` 를 보고 즉시 닫아 버렸음. **no-hover 환경에서는 `onFocus`/`onBlur` 자동 열기·닫기를 비활성**하고 클릭만 토글 트리거로 사용 (데스크탑 hover/포커스 경로는 그대로)
- "팝오버가 사라지지 않는 문제": 외부 pointerdown close 조건이 `source==='click'` 으로만 제한되어 focus 로 열린 상태에서 외부 탭이 무시됐음. **hover 가 아닌 모든 source(click·focus)** 에서 외부 pointerdown 시 닫히도록 확장
- 검증: matchMedia 를 no-hover 로 위조한 상태로 컴포넌트 재마운트 후 (첫 탭 열림 → 같은 마커 재탭 닫힘 → 외부 pointerdown 닫힘) 시나리오 모두 통과. `npm run lint`, `npm run build` 통과

---

## 2026-05-13 (저녁)

**글로서리 파이프라인 2단계 LLM 구조로 전면 재설계**:
- 기존 1단계(사용자가 워크북 직접 작성) → 운영 부담이 큼. **분야별 reference → LLM stage 1(용어 추출) → 검수 → LLM stage 2(설명 생성) → 머지** 의 2단계 흐름으로 전환
- 데이터 모델도 *term-level* 에서 **concept-level + per-tech surface span** 으로 변경. 같은 개념의 여러 표기("ALD" / "원자층증착법" / "원자층증착법(ALD, Atomic Layer Deposition)") 가 본문마다 다르게 등장해도 한 concept 으로 묶이고, 각 기술 본문에서 어디를 어떤 표기로 highlight 할지는 별도의 `term_spans.json` 이 정확히 지정

**파이프라인 (10 단계)**:
1. `node scripts/glossary/01_build_reference.mjs` → `input/glossary/stage1_reference.csv` (삭제 상태 제외 현행 기술 365건)
2. `node scripts/glossary/02_split_reference_chunks.mjs` → `input/glossary/stage1_reference_chunks/NN_<dataset>_<sector>.csv` (sector_name 중점 정규화 후 22 파일)
3. **[LLM 1단계]** 분야 파일 + `scripts/glossary/prompts/stage1_extract_terms.md` → `[{tech_id, surfaces: [{surface, domain_hint}, …]}]` 반환 → `input/glossary/stage1_extractions/*.json`
4. `node scripts/glossary/03_combine_extractions.mjs` → `input/glossary/workbook.csv` (한 행 = (tech_id, surface), 검수용 `keep`/`note` 컬럼 포함)
5. **[사용자 검수]** workbook 편집
6. `node scripts/glossary/04_aggregate_concepts.mjs` → `input/glossary/concepts.json` (concept 단위 클러스터, primary canonical + sample_techs + sample_contexts)
7. `node scripts/glossary/05_chunk_concepts.mjs` → `input/glossary/stage2_chunks/NN.json` (기본 80개씩, 완료된 batch 번호는 보존)
8. **[LLM 2단계]** chunk + `scripts/glossary/prompts/stage2_write_glossary.md` → `[{concept_id, en_abbrev, en_full, korean, domain, short, related?}]` → `input/glossary/stage2_batches/*.json`
9. `node scripts/glossary/06_merge_batches.mjs` → `input/glossary/glossary.csv` (단일 CSV, 컬럼: `concept_id, en_abbrev, en_full, korean, domain, short, related`)
10. `dashboard/scripts/copyGlossary.js` (`predev`/`prebuild`): `glossary.csv` + `workbook.csv` + `concepts.json` 종합 → `dashboard/public/data/glossary.json` (concept entries) + `term_spans.json` (`{tech_id: [{surface, concept_id}, …]}`)

**런타임 매칭 방식 변경**:
- 기존: 전역 글로서리의 모든 term/alias 를 정규식으로 본문에 brute-force 매칭
- 변경: `useGlossary` 훅이 glossary + spans 두 파일 로드 → `GlossarizedText` 가 `techId` 별 spans 의 surface 들로만 본문을 토큰화. 매칭은 정확한 substring(같은 surface 가 본문에 여러 번 나오면 모두 highlight). concept 별 entry 는 popover 표시에 사용
- `dashboard/src/utils/techId.js` 가 `dataset::sector_number::subsector_code::item_no` 키를 생성 (스크립트의 `_tech_id.mjs` 와 동일 규칙). 분야명 변경에도 키가 안정
- 사업화시설 본문도 부모 기술의 spans 로 토큰화 → "기술과 동일한 surface 가 있는 경우에만 highlight" 규칙이 자동 충족(별도 restrictTo 로직 불필요)

**팝오버 표시 규칙 (surface 형태별)**:
- surface 가 영문 약어(ALL CAPS 등): aliases = `en_full + korean`
- surface 가 영문 풀(공백 포함): aliases = `en_abbrev + korean`
- surface 가 한글 또는 `한글(영문)` 페어: aliases = `en_abbrev + en_full`
- glossary entry 는 세 슬롯(`en_abbrev` / `en_full` / `korean`) 을 가능한 모두 채우도록 LLM 프롬프트에 명시

**제거된 자산**:
- `scripts/normalize_terms.mjs` (`aggregate_concepts.mjs` 로 대체)
- `dashboard/src/hooks/useGlossaryEntries.js` (spans 기반 매칭으로 불필요)
- 이전 1단계 LLM 출력 형식 자료들

**검증**:
- 샘플 4 surfaces(AMOLED 패널 기술의 `AMOLED`, `TFT`, `저온폴리실리콘(LTPS)`, `FHD`) 로 end-to-end 검증
  - tech 본문/사업화시설 본문에서 정확히 4개 surface 가 underline
  - 팝오버 aliases 가 surface 형태별 규칙대로 표시 (`TFT` → `Thin Film Transistor · 박막 트랜지스터`, `저온폴리실리콘(LTPS)` → `LTPS · Low-Temperature Poly-Silicon`, …)
  - 모바일(no-hover) 시뮬레이션에서 첫 탭 열림 → 재탭 닫힘 → 외부 탭 닫힘 모두 통과
- `npm run lint`, `npm run build` 통과

**Stage 1 범위 축소**:
- LLM 용어 추출 및 설명 부여 범위를 `current=True` 전체(현행+폐지 최종행)에서 **삭제 상태가 아닌 현행 기술**로 축소. 폐지 기술과 폐지 분야가 섞여 workbook 검수 비용이 커지는 문제를 피하기 위한 결정
- `scripts/glossary/01_build_reference.mjs` 필터를 `current=True && status !== '삭제'` 로 변경해 reference 를 459건에서 365건으로 축소하고, 분야 chunk 를 25개에서 22개로 재생성
- 기존 검수 작업을 보호하기 위해 `input/glossary/workbook.csv` 는 새 reference 에 남는 `tech_id` 만 필터링
- `scripts/glossary/03_combine_extractions.mjs` 재실행 시 기존 workbook 의 동일 `(tech_id, surface)` 행에 있는 `keep`/`note`/`domain_hint` 값을 보존하도록 보강

---

## 2026-05-20

**글로서리 작업 디렉터리 정리**:
- 글로서리 관련 입력과 산출물을 `input/glossary/` 아래로 통합
  - `stage1_reference.csv`, `stage1_reference_chunks/`, `stage1_extractions/`, `workbook.csv`
  - `concepts.json`, `stage2_chunks/`, `stage2_batches/`, `glossary.csv`
- 글로서리 스크립트를 `scripts/glossary/` 아래 번호 순서 파일로 정리
  - `01_build_reference.mjs` → `06_merge_batches.mjs`
  - 프롬프트는 `scripts/glossary/prompts/stage1_extract_terms.md`, `stage2_write_glossary.md`
- 제거: `.DS_Store`, 25분야 시절 legacy extraction 백업, 현행 필터 전 workbook 백업, 빈 구버전 디렉터리
- `dashboard/scripts/copyGlossary.js` 는 새 경로(`input/glossary/glossary.csv`, `workbook.csv`, `concepts.json`)를 읽도록 변경

**Stage 2 chunk 크기 조정**:
- Gemini 3.5 Flash의 긴 컨텍스트를 전제로, 완료된 `01`~`05` batch 는 보존하고 나머지 concept 을 80개 단위로 재분할
- Stage 2 chunk 수가 38개에서 14개로 줄어 남은 작업은 `06`~`14` 9개 batch
- `scripts/glossary/05_chunk_concepts.mjs` 는 `stage2_batches/NN.json` 에 이미 비어 있지 않은 응답이 있으면 해당 번호 chunk 를 잠그고, 이후 concept 만 다시 묶도록 보강

**Stage 2 응답 검증 및 글로서리 적용**:
- 긴 출력 후반부에서 `전력 전력`, `기판 기판` 같은 인접 반복어가 증가하는 현상을 확인해 `scripts/glossary/07_validate_batches.mjs` 검증 스크립트 추가
- 품질 저하가 컸던 `11`~`13` batch 는 기존 응답을 폐기하고 각 80개 chunk 를 40개씩 둘로 나눠 `11`~`16` 으로 재생성. 기존 마지막 `14` batch 는 `17` 로 이동
- 전체 Stage 2 batch 에 대해 인접 반복어를 후처리하고 `스택`, `실린더헤드`, `신호선`의 남은 반복 표현을 수동 정리
- `06_merge_batches.mjs` 로 `input/glossary/glossary.csv` 생성: 742 concepts 중 `short: null` 5건 제외, 최종 737 concepts
- `copyGlossary.js` 동기화 결과 `dashboard/public/data/glossary.json` 737 concepts, `term_spans.json` 929 surfaces / 279 techs 생성. 제외된 5건은 `최적활성`, `형상`, `트래픽`, `크레인`, `팬`
- 검증: `node scripts/glossary/07_validate_batches.mjs` 인접 반복어 0건, concept coverage 742/742, `npm run lint`, `npm run build` 통과

---

## 향후 개발 계획

- [x] 다크모드 구현
- [x] 과학기술 쉽게 설명하기 기능 1차 구현 (정적 글로서리 + 팝오버)
- [x] 글로서리 파이프라인 2단계 LLM 구조 재설계 (concept + per-tech spans)
- [x] 모바일 팝오버 버그 수정
- [x] 운영자가 Stage 2 chunk 를 LLM에 돌리고 `input/glossary/stage2_batches/*.json` 저장 → 글로서리 본격 적용
- [ ] 팝오버에 관련 용어(`related`) 칩 + 점프 동작
- [ ] 법령 개정 시 자동 재파싱 및 버전별 diff 리포트
- [ ] 화면 내 텍스트 확대/축소 기능 구현
