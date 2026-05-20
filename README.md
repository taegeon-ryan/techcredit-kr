# 조세특례제한법 첨단기술 현황판

조세특례제한법 시행령 **[별표 7] 신성장·원천기술**과 **[별표 7의2] 국가전략기술** 목록을 시각적으로 탐색할 수 있는 대시보드입니다. 법령 HWPX 원문을 파싱해 CSV로 만들고, 분야·소분야·세부기술·사업화시설을 연결해 변경 연혁과 연관 기술까지 한눈에 볼 수 있도록 정리했습니다.

🔗 **데모(Beta)**: [https://techcredit-kr.vercel.app](https://techcredit-kr.vercel.app)

---

## 기술 스택

- **프론트엔드**: React 19, Vite
- **데이터 파이프라인**: Python
- **배포**: Vercel

---

## 디렉토리 구조

```
.
├── input/        # 법령 HWPX 원본
├── parsers/      # HWPX → CSV 파서 스크립트
├── output/       # 파싱 결과 CSV
└── dashboard/    # Vite + React 대시보드
    ├── src/utils/     # 프론트엔드 내 데이터 가공 유틸
    └── src/components/     # React 컴포넌트
```

---

## 로컬 실행

```bash
cd dashboard
npm install
npm run dev    # http://localhost:5173
```

CSV를 다시 만들려면 `parsers/` 안의 Python 스크립트를 실행하면 됩니다.

---

## 주요 배포 이력

| 일자 | 배포 내역 |
|---|---|
| 2026-04-22 | 법령 HWPX/PDF 파서 구축, CSV 생성 |
| 2026-04-24 | 카드뷰·통계 차트·기술 목록 구현 |
| 2026-04-29 | GitHub 공개 및 Vercel 배포 |
| 2026-05-07 | 세부기술 적용시기/사업화시설 표기 개선 |
| 2026-05-08 | 변경 연혁 diff, 연관 기술 추천 |

상세 개발 이력은 [`dev_notes.md`](./dev_notes.md)에 정리되어 있습니다.

---

## 라이선스

[MIT](./LICENSE)
