import zipfile
import xml.etree.ElementTree as ET
import csv
import re
import os
import sys
from datetime import date, timedelta
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_ROOT           = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
STRAT_FAC_DIR   = os.path.join(_ROOT, "input", "facility", "strategic")
NEW_FAC_DIR     = os.path.join(_ROOT, "input", "facility", "newgrowth")
STRAT_FAC_OUT   = os.path.join(_ROOT, "output", "strategic_facility.csv")
NEW_FAC_OUT     = os.path.join(_ROOT, "output", "newgrowth_facility.csv")
STRAT_TECH_CSV  = os.path.join(_ROOT, "output", "strategic_tech.csv")
NEW_TECH_CSV    = os.path.join(_ROOT, "output", "newgrowth_tech.csv")

# ── 적용시기 매핑 (시행규칙 개정일 → 적용 연월) ───────────────────────
APPLY_MAP = {
    "170317": (2017, 1),
    "190320": (2019, 1),
    "200313": (2020, 1),
    "210316": (2021, 1),
    "220318": (2022, 1),
    "230320": (2023, 1),
    "230607": (2023, 1),
    "230829": (2023, 7),
    "240322": (2024, 1),
    "250321": (2025, 1),
    "251128": (2025, 7),
    "260320": (2026, 1),
}

# 특수 케이스: 시행령과 동일하게 인공지능 분야는 251128에 2025.1 적용
APPLY_OVERRIDE = {
    ("251128", "인공지능"): (2025, 1),
}

NS_HP = "http://www.hancom.co.kr/hwpml/2011/paragraph"

STRAT_ITEM_RE = re.compile(r"^([\uAC00-\uD7A3])\.\s*")
NEW_ITEM_RE   = re.compile(r"^(\d+)\)\s*")


# ── 공통 유틸 ──────────────────────────────────────────────────────────
def compute_apply_date(version: str, sector_name: str, status: str) -> str:
    ym = APPLY_OVERRIDE.get((version, sector_name)) or APPLY_MAP.get(version)
    if not ym:
        return ""
    first_day = date(ym[0], ym[1], 1)
    eff = (first_day - timedelta(days=1)) if status == "삭제" else first_day
    return eff.strftime("%Y-%m-%d")


def cell_text(tc):
    return "".join(t.text for t in tc.iter(f"{{{NS_HP}}}t") if t.text).strip()


def extract_version(fname):
    m = re.search(r"_(\d{6})\.hwpx$", fname)
    return m.group(1) if m else "000000"


def row_col_map(tr):
    col_map = {}
    for tc in tr.findall(f"{{{NS_HP}}}tc"):
        addr = tc.find(f"{{{NS_HP}}}cellAddr")
        if addr is None:
            continue
        col_map[int(addr.get("colAddr", -1))] = cell_text(tc)
    return col_map


def get_table_rows(path, skip_rows=4):
    with zipfile.ZipFile(path) as z:
        with z.open("Contents/section0.xml") as f:
            root = ET.fromstring(f.read())
    tbl = next(root.iter(f"{{{NS_HP}}}tbl"))
    all_rows = list(tbl.iter(f"{{{NS_HP}}}tr"))
    return all_rows[skip_rows:]


def split_sector(s):
    """'2. 이차전지' → ('2', '이차전지'),  '반도체' → ('', '반도체')"""
    m = re.match(r"^(\d+)\.\s*(.*)", (s or "").strip())
    return (m.group(1), m.group(2).strip()) if m else ("", s.strip())


def _kor_prefix(s):
    """'나. 전기 구동차' → '나'"""
    m = re.match(r"^([\uAC00-\uD7A3])", s or "")
    return m.group(1) if m else s


def norm_sector(s):
    """공백·중간점 변이 등 제거 → 한글+영문+숫자만 남김 (sector_order 키 및 has_facility 매칭)"""
    return re.sub(r"[^A-Za-z0-9\uAC00-\uD7A3]", "", s or "")


# ── 국가전략기술 사업화시설 파서 ───────────────────────────────────────
# 버전별 컬럼 배치가 다름:
#   220318~251128: col0=분야, col2=기술명, col3=시설설명
#   260320~      : col0=분야, col1=기술명, col2=시설설명
def parse_strategic_facility(path, sector_order: dict):
    records = []
    current_sector_name   = ""
    current_sector_number = ""

    for tr in get_table_rows(path, skip_rows=4):
        cm = row_col_map(tr)
        c0 = cm.get(0, "").strip()
        c1 = cm.get(1, "").strip()
        c2 = cm.get(2, "").strip()
        c3 = cm.get(3, "").strip()

        if c0.startswith("비고"):
            continue

        sector_changed = False
        if c0:
            _, name = split_sector(c0)
            if not name:
                name = c0
            _nk = norm_sector(name)
            if _nk not in sector_order:
                sector_order[_nk] = str(len(sector_order) + 1)
            current_sector_name   = name
            current_sector_number = sector_order[_nk]
            sector_changed = True

        # 형식 자동 판별: 기술명이 col1(신형식)인지 col2(구형식)인지
        if c1 and STRAT_ITEM_RE.match(c1):
            item_raw, fac_raw = c1, c2
        elif c2 and STRAT_ITEM_RE.match(c2):
            item_raw, fac_raw = c2, c3
        elif sector_changed and (c1 or c2):
            # 분야 공통 시설 (예: 251128/260320 인공지능 "공통") — 항목 번호 없이 분야 전체에 적용
            if c1 and c2:  # 신형식: c1=기술명, c2=설명
                item_raw, fac_raw = c1, c2
            else:          # 구형식: c2=기술명, c3=설명
                item_raw, fac_raw = (c2 or c1), c3
            records.append({
                "sector_number":       current_sector_number,
                "sector_name":         current_sector_name,
                "item_no":             "",
                "tech_name":           item_raw.strip(),
                "facility_description": fac_raw,
            })
            continue
        else:
            # 연속행 (복수 조건 항목): 이전 레코드에 이어붙임
            continuation = c3 if c3 else c2
            if continuation and records:
                records[-1]["facility_description"] += "\n" + continuation
            continue

        m = STRAT_ITEM_RE.match(item_raw)
        item_no   = (m.group(1) + ".") if m else ""
        tech_name = item_raw[m.end():].strip() if m else item_raw.strip()
        records.append({
            "sector_number":       current_sector_number,
            "sector_name":         current_sector_name,
            "item_no":             item_no,
            "tech_name":           tech_name,
            "facility_description": fac_raw,
        })

    return records


# ── 신성장원천기술 사업화시설 파서 ─────────────────────────────────────
def parse_newgrowth_facility(path, sector_order: dict):
    records = []
    current_sector_name   = ""
    current_sector_number = ""
    current_subsector     = ""

    for tr in get_table_rows(path, skip_rows=4):
        cm = row_col_map(tr)
        c0 = cm.get(0, "").strip()
        c1 = cm.get(1, "").strip()
        c2 = cm.get(2, "").strip()
        c3 = cm.get(3, "").strip()

        if c0:
            _, name = split_sector(c0)
            if not name:
                name = c0
            _nk = norm_sector(name)
            if _nk not in sector_order:
                sector_order[_nk] = str(len(sector_order) + 1)
            current_sector_name   = name
            current_sector_number = sector_order[_nk]

        # 소분야 갱신 (삭제 표기도 추적)
        if c1:
            current_subsector = c1.strip()

        if not c2:
            continue

        m = NEW_ITEM_RE.match(c2)
        item_no   = (m.group(1) + ")") if m else ""
        tech_name = c2[m.end():].strip() if m else c2.strip()

        # 삭제 표기 — 명시적 삭제 레코드로 기록 (diff 엔진이 이전 이름 복원)
        if tech_name.startswith("삭제"):
            records.append({
                "sector_number":       current_sector_number,
                "sector_name":         current_sector_name,
                "subsector":           current_subsector,
                "item_no":             item_no,
                "tech_name":           "삭제",
                "facility_description": "",
            })
            continue

        if not c3:
            continue  # 시설 설명 없는 항목은 건너뜀

        records.append({
            "sector_number":       current_sector_number,
            "sector_name":         current_sector_name,
            "subsector":           current_subsector,
            "item_no":             item_no,
            "tech_name":           tech_name,
            "facility_description": c3,
        })

    return records


# ── 키 함수 ────────────────────────────────────────────────────────────
def make_key_strategic(item):
    return (item["sector_number"], item["item_no"])


def make_key_newgrowth(item):
    return (item["sector_number"], _kor_prefix(item["subsector"]), item["item_no"])


# ── 정렬 키 ────────────────────────────────────────────────────────────
def _row_sort_key(r):
    """sector_number → subsector → item_no → version 순 오름차순"""
    try:
        sn = int(r.get("sector_number") or 0)
    except (ValueError, TypeError):
        sn = 0
    ss  = r.get("subsector") or ""
    ino = (r.get("item_no") or "").strip()
    m   = re.match(r"^(\d+)\)$", ino)
    if m:
        ino_key = (0, int(m.group(1)), "")
    elif ino:
        ino_key = (0, 0, ino)
    else:
        ino_key = (-1, 0, "")
    return (sn, ss, ino_key[0], ino_key[1], ino_key[2], r.get("version", ""))


def _current_deleted_duplicate_key(row):
    return (
        norm_sector(row.get("sector_name", "")),
        norm_sector(row.get("subsector", "")),
        norm_sector(row.get("tech_name", "")),
    )


def collapse_duplicate_current_deletions(rows):
    """번호 이동 후 최종 폐지된 동일 시설은 최신 폐지행만 current로 둔다."""
    groups = {}
    for row in rows:
        if row.get("current") and row.get("status") == "삭제":
            key = _current_deleted_duplicate_key(row)
            if key[2]:
                groups.setdefault(key, []).append(row)

    for group in groups.values():
        if len(group) <= 1:
            continue
        group.sort(key=lambda r: (r.get("apply_date", ""), r.get("version", "")))
        for row in group[:-1]:
            row["current"] = False


# ── 버전별 diff 빌더 ───────────────────────────────────────────────────
def build_diff(parse_fn, folder, key_fn, data_fields, output_path):
    files = sorted(
        [(extract_version(f), os.path.join(folder, f))
         for f in os.listdir(folder) if f.endswith(".hwpx")],
        key=lambda x: x[0],
    )

    state        = {}   # key → index in rows
    rows         = []
    sector_order = {}   # 전 버전 공유 sector_name → number

    for version, path in files:
        fname = os.path.basename(path)
        try:
            items = parse_fn(path, sector_order)
        except Exception as e:
            print(f"  SKIP {fname}: {e}")
            continue

        print(f"  v{version}: {len(items)}항목 파싱")

        seen_keys = set()

        for item in items:
            key  = key_fn(item)
            name = item["tech_name"]
            desc = item["facility_description"]
            seen_keys.add(key)

            if key not in state:
                row = {f: item.get(f) for f in data_fields}
                row.update(version=version, current=True, status="신설")
                row["apply_date"] = compute_apply_date(version, item.get("sector_name", ""), "신설")
                rows.append(row)
                state[key] = len(rows) - 1
            else:
                prev = rows[state[key]]
                if name == prev["tech_name"] and desc == prev["facility_description"]:
                    continue  # 변경 없음
                prev["current"] = False
                is_del     = name.startswith("삭제")
                status_val = "삭제" if is_del else "변경"
                row = {f: prev.get(f) if is_del else item.get(f) for f in data_fields}
                row.update(version=version, current=True, status=status_val)
                row["apply_date"] = compute_apply_date(
                    version,
                    (prev if is_del else item).get("sector_name", ""),
                    status_val,
                )
                rows.append(row)
                state[key] = len(rows) - 1

        # 이번 버전에 없는 current 항목 → 암묵적 삭제
        for key, idx in list(state.items()):
            prev = rows[idx]
            if prev["current"] and prev["status"] != "삭제" and key not in seen_keys:
                prev["current"] = False
                new_row = {f: prev.get(f) for f in data_fields}
                new_row.update(version=version, current=True, status="삭제")
                new_row["apply_date"] = compute_apply_date(
                    version, prev.get("sector_name", ""), "삭제"
                )
                rows.append(new_row)
                state[key] = len(rows) - 1

    collapse_duplicate_current_deletions(rows)

    rows.sort(key=_row_sort_key)
    for i, row in enumerate(rows, 1):
        row["index"] = i

    fieldnames = ["index"] + data_fields + ["version", "apply_date", "status", "current"]
    with open(output_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    total   = len(rows)
    current = sum(1 for r in rows if r["current"])
    print(f"  → {os.path.basename(output_path)}: 총 {total}행  "
          f"(current={current} / historical={total - current})\n")


# ── tech CSV 에 has_facility 컬럼 추가 ────────────────────────────────
def add_has_facility():
    # 현행(current=True) 시설 항목의 키 집합 구성
    strat_keys = set()
    new_keys   = set()

    with open(STRAT_FAC_OUT, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            if r.get("current") == "True":
                strat_keys.add((norm_sector(r["sector_name"]), r["item_no"]))

    with open(NEW_FAC_OUT, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            if r.get("current") == "True":
                new_keys.add((norm_sector(r["sector_name"]), _kor_prefix(r["subsector"]), r["item_no"]))

    def _update(tech_csv, key_fn, fac_keys):
        with open(tech_csv, encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            fieldnames = reader.fieldnames
            rows = list(reader)

        if "has_facility" not in fieldnames:
            fieldnames = fieldnames + ["has_facility"]

        for row in rows:
            k = key_fn(row)
            row["has_facility"] = "TRUE" if k in fac_keys else "FALSE"

        with open(tech_csv, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(rows)

        matched = sum(1 for r in rows if r["has_facility"] == "TRUE")
        print(f"  has_facility 업데이트: {os.path.basename(tech_csv)} "
              f"→ TRUE {matched}건 / 전체 {len(rows)}행")

    _update(
        STRAT_TECH_CSV,
        lambda r: (norm_sector(r["sector_name"]), r["item_no"]),
        strat_keys,
    )
    _update(
        NEW_TECH_CSV,
        lambda r: (norm_sector(r["sector_name"]), _kor_prefix(r["subsector"]), r["item_no"]),
        new_keys,
    )


def main():
    print("=== 국가전략기술 사업화시설 ===")
    build_diff(
        parse_fn    = parse_strategic_facility,
        folder      = STRAT_FAC_DIR,
        key_fn      = make_key_strategic,
        data_fields = ["sector_number", "sector_name", "item_no",
                       "tech_name", "facility_description"],
        output_path = STRAT_FAC_OUT,
    )

    print("=== 신성장원천기술 사업화시설 ===")
    build_diff(
        parse_fn    = parse_newgrowth_facility,
        folder      = NEW_FAC_DIR,
        key_fn      = make_key_newgrowth,
        data_fields = ["sector_number", "sector_name", "subsector", "item_no",
                       "tech_name", "facility_description"],
        output_path = NEW_FAC_OUT,
    )

    print("=== tech CSV has_facility 업데이트 ===")
    add_has_facility()


if __name__ == "__main__":
    main()
