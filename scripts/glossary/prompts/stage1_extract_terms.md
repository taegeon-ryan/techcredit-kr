# 용어 추출 프롬프트 (Stage 1 / per-sector)

## 사용 절차

1. `node scripts/glossary/01_build_reference.mjs && node scripts/glossary/02_split_reference_chunks.mjs` 로
   `input/glossary/stage1_reference_chunks/NN_<dataset>_<sector>.csv` 22개 현행 분야 파일 생성
2. 분야 파일 한 개씩 Claude/ChatGPT/Gemini 채팅에 업로드 + 본 프롬프트 본문 붙여넣기
3. 응답(JSON 배열)을 `input/glossary/stage1_extractions/NN_<dataset>_<sector>.json` 으로 저장
   (파일명은 입력 분야 파일 그대로 유지하되 확장자만 `.json`)
4. 모든 분야 끝나면 `node scripts/glossary/03_combine_extractions.mjs` 로 `input/glossary/workbook.csv` 생성

---

## 프롬프트 본문 (복붙)

```
당신은 조세특례제한법 시행령의 국가전략기술/신성장원천기술 대시보드를 위해
"각 기술 본문에서 일반 직원이 모를 만한 전문 용어"를 추출하는 작업자입니다.

입력은 한 분야의 기술 목록이 담긴 CSV 입니다. 각 행:
  tech_id, dataset, sector_name, subsector, item_no, tech_name, tech_description

## 출력 규칙

1. 응답은 **JSON 배열만** 출력합니다. 코드펜스/주석/머리말 없음.
2. 각 원소는 한 기술에 대응:
   {
     "tech_id": "<입력의 tech_id 그대로>",
     "surfaces": [
       { "surface": "<본문에 등장하는 그대로의 substring>", "domain_hint": "<짧은 한글 도메인 라벨>" },
       …
     ]
   }
3. 입력에 있는 모든 tech_id 에 대해 한 원소씩 출력합니다. surfaces 가 비면 빈 배열로.

## 추출 지침

- **surface 는 본문에 등장하는 그대로**의 substring 이어야 합니다.
  - 예: 본문에 `원자층증착법(ALD, Atomic Layer Deposition)` 으로 등장하면 그 전체를 한 surface 로,
    `ALD` 만 단독 등장한 다른 기술에서는 `ALD` 가 surface 입니다.
  - 본문에 없는 표기는 절대 만들지 않습니다(공백·중점·괄호도 본문 그대로).
- surface 후보:
  - 영문 약어 (예: `ALD`, `HBM`, `CVD`, `DRAM`)
  - 영문 풀네임 (예: `Atomic Layer Deposition`, `High Bandwidth Memory`)
  - `한글(영문)` / `영문(한글)` 페어 (예: `원자층증착법(ALD, Atomic Layer Deposition)`)
  - 일반인이 의미를 모를 만한 한글 전문어 (예: `전구체`, `박막`, `증착`, `유전특성`, `에피`)
- 제외:
  - 단독 일반 단어: "기술", "시스템", "공정", "장비", "부품", "소재" 등
  - 단독 분야명: "반도체", "에너지", "디스플레이" 등 (`HBM`, `DRAM` 같은 구체 용어는 OK)
  - 수치·단위 표현 (`15nm`, `1ppm`, `0.8㎛`)
  - 조사/어미만 다른 변형 표기 — 같은 본문에서 `메모리`, `메모리반도체`, `메모리 반도체` 가 모두 나오면
    가장 정보적인 표기 **한 개**만 선택 (보통 가장 긴 표기 또는 영문 약어가 함께 표기된 표기)
- 한 기술 본문에서 같은 surface 가 여러 번 등장해도 surfaces 배열에는 **한 번**만 적습니다.
- **본문 표기가 다르면 다른 surface**: 같은 개념이라도 본문이 `ALD` 와 `원자층증착법(ALD, Atomic Layer Deposition)` 두 가지로 등장하면 (서로 다른 기술 행에서) 각각의 행 surfaces 에 자기 본문 그대로 적습니다. 통합은 이후 스크립트가 처리합니다.

## domain_hint

- 짧은 한글 분야 라벨 (예: `반도체`, `디스플레이`, `이차전지`, `미래차`, `바이오`, `에너지`, `소재`, `AI`, `로봇`, `통신`, `보안`, `우주`, `원자력`, `수소` 등)
- 입력의 sector_name 을 기본값으로 두되, **용어 자체의 분야가 sector_name 과 다르면 용어 분야를 우선** (예: 차세대전자정보 디바이스 분야 안의 `OLED` 는 `디스플레이`)

## 예시

입력:
tech_id,dataset,sector_name,subsector,item_no,tech_name,tech_description
strategic::1::::거.,strategic,반도체,,거.,원자층증착법 및 화학증착법을 위한 고유전체용 전구체 개발 기술,"기존의 이산화규소(SiO2)보다 우수한 유전특성을 갖는 high-k dielectric 박막 증착을 위한 원자층증착법(ALD, Atomic Layer Deposition) 및 화학증착법(CVD, Chemical Vapor Deposition)공정에 사용되는 전구체를 개발하는 기술"

출력:
[
  {
    "tech_id": "strategic::1::::거.",
    "surfaces": [
      {"surface": "이산화규소(SiO2)", "domain_hint": "반도체"},
      {"surface": "유전특성", "domain_hint": "반도체"},
      {"surface": "high-k dielectric", "domain_hint": "반도체"},
      {"surface": "박막", "domain_hint": "반도체"},
      {"surface": "증착", "domain_hint": "반도체"},
      {"surface": "원자층증착법(ALD, Atomic Layer Deposition)", "domain_hint": "반도체"},
      {"surface": "화학증착법(CVD, Chemical Vapor Deposition)", "domain_hint": "반도체"},
      {"surface": "전구체", "domain_hint": "반도체"}
    ]
  }
]

## 입력 CSV
<csv>
```

---

## 운영 팁

- 한 분야 파일이 너무 크면 사용자가 LLM 입력 시 임의로 절반씩 잘라서 두 번 호출하고, 응답을 합쳐 한 파일로 저장하면 됩니다 (스크립트가 동일 `tech_id` 의 surfaces 를 합쳐 줍니다).
- 응답에 코드펜스가 섞여도 combine 스크립트가 `[`~`]` 만 추출합니다.
- surface 가 본문에 없으면 런타임에서 highlight 되지 않으니, **반드시 본문 substring 그대로** 출력하도록 강조.
