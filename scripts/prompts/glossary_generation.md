# 용어집 설명 생성 프롬프트 (Claude.ai 채팅용)

## 사용 절차

1. `node scripts/extract_terms.mjs` 로 `input/glossary_candidates.json` 생성
2. 후보 JSON을 열어 불필요한 일반 약어(예: 단위·일반 IT 약자) 삭제, 표기 통합
3. Claude.ai 채팅에 **데이터 4개 CSV** 와 검수된 후보 중 **20개씩** 업로드
   - `dashboard/public/data/strategic_tech.csv`
   - `dashboard/public/data/strategic_facility.csv`
   - `dashboard/public/data/newgrowth_tech.csv`
   - `dashboard/public/data/newgrowth_facility.csv`
4. 아래 **프롬프트 본문**을 그대로 붙여넣고 마지막 `<candidates>` 슬롯에 60개를 JSON 배열로 채움
5. 응답을 `input/glossary_batches/01.json`, `02.json` … 식으로 저장
6. `node scripts/merge_glossary.mjs` 로 `input/glossary_source.json` 으로 머지
7. 운영자가 결과를 수기 검수 → `npm run dev`로 확인 (`prebuild`/`predev`가 `glossary.json`을 dashboard/public/data로 복사)

## 배치 크기 산정

- 단어당 출력 ≈ short 250자(약 200 토큰) + aliases/domain/JSON 오버헤드 40 토큰 = 약 240 토큰
- Claude.ai 한 응답 안전선 ~5,500 출력 토큰 → 배치당 **약 20단어** 권장
- 검수된 후보가 400단어라면 **20 배치 안팎**으로 완료

---

## 프롬프트 본문 (복붙)

```
당신은 조세특례제한법 시행령의 국가전략기술/신성장원천기술을 다루는 대시보드의
용어집 작성 작가입니다. 사용자는 대부분 문과 전공의 일반 직원이며,
과학기술 전공자가 아닌 일반 성인 수준의 이해도를 가집니다.

업로드된 4개 CSV는 우리 대시보드가 다루는 실제 기술/시설 본문입니다.
이 본문에 등장하는 약어·전문용어를 풀어 설명해 주세요.

## 출력 규칙
1. 응답은 **JSON 배열만** 출력합니다. 코드펜스/주석/머리말 없음.
2. 각 원소 스키마:
   {
     "term": "<원문 표기 그대로>",
     "aliases": ["<표기 변형이나 풀네임>", ...],   // 선택. 없으면 생략
     "short": "<50~100자 한국어 한 문장>",          // 필수
     "domain": "<반도체|디스플레이|이차전지|AI|바이오|미래차|에너지|소재|기타>", // 선택
     "related": ["<관련 용어>", ...]               // 선택. 입력 후보 내 다른 term만 허용
   }
3. `short` 작성 지침
   - **200~300자**(2~4 문장), 종결어미는 부드러운 경어체 **"…입니다", "…합니다", "…쓰입니다"**
   - **풀네임/한글 직역은 `aliases`로만 노출**되니, 본문에서 `"X는 Y의 약자로, 우리말로는 Z라고 합니다"` 같은 문장을 반복하지 않는다 (UI가 `aliases` 라인을 별도로 표시함)
   - 구성 권장: ① 한 줄로 정의 ② 작동 원리나 핵심 특징 ③ 어디에 쓰이는지·왜 중요한지
   - 비유는 일반 성인이 이해할 수 있는 수준까지 허용 (예: "원자를 한 층씩 차례로 쌓아 올리는 방식")
   - 과장·홍보 표현 금지("최고", "최신", "혁신적인" 등 형용사 자제)
   - 회사명/제품명 사용 금지
4. `domain` 작성 지침
   - 후보에 `domainCandidates` 배열이 있으면 그 안에서 **`sampleContexts`와 가장 잘 어울리는 라벨 한 개**를 골라 `domain`에 넣는다 (예: `["반도체","디스플레이","센서","전자정보"]` 중 용어가 디스플레이 관련이면 `"디스플레이"`)
   - `domainCandidates`가 없고 후보의 `domain` 값이 채워져 있으면 그 값을 그대로 사용
   - 모두 비어 있으면 `domain` 필드를 비워 둠 (혹은 가장 가까운 분야 라벨을 직접 부여)
5. `aliases` 작성 지침
   - 입력 후보의 `aliases`를 그대로 보존하고, 영문 풀네임/한글 직역이 빠져 있으면 보강한다 (예: `Active-Matrix OLED`, `능동형 유기발광다이오드`)
6. 후보 용어 중 의미가 불분명하거나 일반 단어인 경우 `"short": null` 로 표시
7. 입력 후보의 `sampleContexts`를 참고해 본 대시보드 문맥(반도체·디스플레이·이차전지·미래차·바이오 등)에 맞춰 작성

## 예시
입력 후보(3개):
[
  { "term": "AMOLED", "aliases": ["Active-Matrix OLED"], "dominantSector": "디스플레이", "domain": "디스플레이", "sampleContexts": ["…AMOLED 패널 제조용 증착시설…"] },
  { "term": "HBM", "aliases": [], "dominantSector": "반도체", "domain": "반도체", "sampleContexts": ["…HBM(High Bandwidth Memory) 스택…"] },
  { "term": "DRAM", "aliases": [], "dominantSector": "차세대 전자정보 디바이스", "domain": "", "domainCandidates": ["반도체","디스플레이","전자","3D프린팅","AR"], "sampleContexts": ["…기존 메모리반도체인 D램(DRAM)…"] }
]

출력:
[
  {
    "term": "AMOLED",
    "aliases": ["Active-Matrix OLED", "능동형 유기발광다이오드"],
    "short": "화소 하나하나에 박막 트랜지스터를 두어 빛을 개별적으로 켜고 끌 수 있게 만든 디스플레이입니다. 유기물이 스스로 빛을 내기 때문에 백라이트 없이도 검은색이 더 깊게 표현되고, 휘어지거나 얇게 만들기 쉬워 스마트폰·TV·웨어러블 화면에 널리 쓰입니다.",
    "domain": "디스플레이"
  },
  {
    "term": "HBM",
    "aliases": ["High Bandwidth Memory", "고대역폭 메모리"],
    "short": "여러 개의 DRAM 칩을 위로 차곡차곡 쌓아 올린 뒤, 미세한 구멍을 뚫어 칩들끼리 직접 연결한 메모리입니다. 데이터가 오갈 통로가 매우 넓어져 한 번에 많은 데이터를 빠르게 전달할 수 있고, AI 학습용 GPU나 고성능 컴퓨팅에 함께 묶여 쓰입니다.",
    "domain": "반도체"
  },
  {
    "term": "DRAM",
    "aliases": ["Dynamic Random Access Memory", "동적 임의접근 기억장치"],
    "short": "작은 축전기 하나에 짧은 전기 신호를 가두는 방식으로 데이터를 기억하는 반도체 메모리입니다. 속도가 빠르지만 시간이 지나면 전하가 새어 나가 주기적으로 새로 써 주는 새로고침 동작이 필요하며, 컴퓨터·서버·스마트폰의 메인 메모리로 가장 널리 쓰입니다.",
    "domain": "반도체"
  }
]

## 후보 (20개)
<candidates>
```

---

## 운영 팁

- 첫 배치 후 출력 톤이 마음에 들지 않으면 본 프롬프트의 "비유" 가이드를 조정 (예: "초등학생 수준" 또는 "전공자 수준")
- 응답에 코드펜스(```json … ```)가 섞여도 `merge_glossary.mjs`가 첫 `[` ~ 마지막 `]` 사이만 추출함
- 충돌(이미 정의된 term에 다른 short가 들어옴) 발생 시 stderr에 양쪽 표시 → 운영자가 `glossary_source.json`을 수기 정정
- `related`는 입력 후보 내 다른 term을 사용해야 하지만, 모델이 외부 용어를 넣어도 런타임에서는 단순 무시됨 (2차 단계에 활용 예정)
