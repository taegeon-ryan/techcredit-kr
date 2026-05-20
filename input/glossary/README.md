# Glossary Pipeline Inputs

## Stage 1: 용어 추출

1. `node scripts/glossary/01_build_reference.mjs`
2. `node scripts/glossary/02_split_reference_chunks.mjs`
3. `stage1_reference_chunks/*.csv` 를 LLM에 넣고 `scripts/glossary/prompts/stage1_extract_terms.md` 로 응답 생성
4. 응답을 같은 basename의 `.json`으로 `stage1_extractions/`에 저장
5. `node scripts/glossary/03_combine_extractions.mjs`
6. `workbook.csv` 검수

## Stage 2: 설명 생성

1. `node scripts/glossary/04_aggregate_concepts.mjs`
2. `node scripts/glossary/05_chunk_concepts.mjs`
3. `stage2_chunks/*.json` 를 LLM에 넣고 `scripts/glossary/prompts/stage2_write_glossary.md` 로 응답 생성
4. 응답을 같은 번호의 `.json`으로 `stage2_batches/`에 저장
5. `node scripts/glossary/06_merge_batches.mjs`
6. `npm run dev` 또는 `npm run build` 시 대시보드용 JSON으로 동기화

`05_chunk_concepts.mjs` 는 기본 80개씩 묶되, 이미 `stage2_batches/NN.json` 에 응답이 채워진 번호는 보존하고 그 이후만 다시 묶습니다.
