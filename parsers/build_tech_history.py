import zipfile
import xml.etree.ElementTree as ET
import csv
import re
import os
import sys
from datetime import date, timedelta
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ── 적용시기 매핑 ──────────────────────────────────────────────────
# 개정일(version) → (년, 월) of 적용연월
APPLY_MAP = {
    "170207": (2017, 1),
    "190212": (2019, 1),
    "200211": (2020, 1),
    "210217": (2021, 1),
    "220215": (2022, 1),
    "230228": (2023, 1),
    "230607": (2023, 1),
    "230829": (2023, 7),
    "240229": (2024, 1),
    "250228": (2025, 1),
    "251128": (2025, 7),
    "260227": (2026, 1),
}

# 특수 케이스: (version, sector_name) → (년, 월)
# 같은 개정에서 특정 분야만 적용연월이 다른 경우
APPLY_OVERRIDE = {
    ("251128", "인공지능"): (2025, 1),
}


def compute_apply_date(version: str, sector_name: str, status: str) -> str:
    """
    신설/변경 → 적용연월 첫째날 (YYYY-MM-DD)
    삭제      → 적용연월 전달 말일 (해당 규정이 유효한 마지막 날)
    """
    ym = APPLY_OVERRIDE.get((version, sector_name)) or APPLY_MAP.get(version)
    if not ym:
        return ""
    first_day = date(ym[0], ym[1], 1)
    eff = (first_day - timedelta(days=1)) if status == "삭제" else first_day
    return eff.strftime("%Y-%m-%d")

_ROOT      = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
STRAT_DIR  = os.path.join(_ROOT, "input", "tech", "strategic")
NEW_DIR    = os.path.join(_ROOT, "input", "tech", "newgrowth")
STRAT_OUT  = os.path.join(_ROOT, "output", "strategic_tech.csv")
NEW_OUT    = os.path.join(_ROOT, "output", "newgrowth_tech.csv")

NS_HP = "http://www.hancom.co.kr/hwpml/2011/paragraph"


def _norm_sector(s: str) -> str:
    """공백·중간점 변이 등 제거 → 한글+영문+숫자만 남김 (sector_order 키로 사용)"""
    return re.sub(r"[^A-Za-z0-9\uAC00-\uD7A3]", "", s or "")

STRAT_SECTOR_RE = re.compile(r"^\d+\.\s*")
STRAT_ITEM_RE   = re.compile(r"^([\uAC00-\uD7A3])\.\s*")
NEW_MAJOR_RE    = re.compile(r"^\d+\.\s*")
NEW_MINOR_RE    = re.compile(r"^[\uAC00-\uD7A3]\.\s*")
NEW_ITEM_RE     = re.compile(r"^(\d+)\)\s*")


def cell_text(tc):
    return "".join(t.text for t in tc.iter(f"{{{NS_HP}}}t") if t.text).strip()


def extract_version(fname):
    m = re.search(r"_(\d{6})\.hwpx$", fname)
    return m.group(1) if m else "000000"


def split_sector(s):
    """'3. 차세대SW(소프트웨어) 및 보안' → ('3', '차세대SW(소프트웨어) 및 보안')"""
    m = re.match(r"^(\d+)\.\s*(.*)", (s or "").strip())
    return (m.group(1), m.group(2).strip()) if m else ("", s.strip())

def _kor_prefix(s):
    """'나. 융합보안' → '나'"""
    m = re.match(r"^([\uAC00-\uD7A3])", s or "")
    return m.group(1) if m else s

def make_key_strategic(item):
    return (item["sector_number"], item["item_no"])

def make_key_newgrowth(item):
    return (item["sector_number"], _kor_prefix(item["subsector"]), item["item_no"])


def get_table_rows(path, skip_rows=3):
    with zipfile.ZipFile(path) as z:
        with z.open("Contents/section0.xml") as f:
            root = ET.fromstring(f.read())
    tbl = next(root.iter(f"{{{NS_HP}}}tbl"))
    all_rows = list(tbl.iter(f"{{{NS_HP}}}tr"))
    return all_rows[skip_rows:]


def row_col_map(tr):
    col_map = {}
    for tc in tr.findall(f"{{{NS_HP}}}tc"):
        addr = tc.find(f"{{{NS_HP}}}cellAddr")
        if addr is None:
            continue
        col_map[int(addr.get("colAddr", -1))] = cell_text(tc)
    return col_map


def find_desc_separator(text):
    depth = 0
    for index, char in enumerate(text or ""):
        if char == "(":
            depth += 1
        elif char == ")" and depth > 0:
            depth -= 1
        elif char == ":" and depth == 0:
            return index
    return -1


def split_name_desc(text):
    colon = find_desc_separator(text)
    if colon != -1:
        return text[:colon].strip(), text[colon + 1:].strip()
    return text, ""


# ── 국가전략기술 파서 ────────────────────────────────────────────
def parse_strategic(path, sector_order: dict):
    records = []
    current_sector_name   = ""
    current_sector_number = ""

    for tr in get_table_rows(path):
        cm = row_col_map(tr)

        if 0 in cm and cm[0].strip():
            _, name = split_sector(cm[0])       # 숫자 prefix 제거
            if not name:
                name = cm[0].strip()
            _nk = _norm_sector(name)
            if _nk not in sector_order:
                sector_order[_nk] = str(len(sector_order) + 1)
            current_sector_name   = name
            current_sector_number = sector_order[_nk]

        if 1 not in cm or not cm[1]:
            continue

        raw = cm[1]
        m = STRAT_ITEM_RE.match(raw)
        item_no = (m.group(1) + ".") if m else None
        tech    = raw[m.end():].strip() if m else raw
        name, desc = split_name_desc(tech)

        records.append({
            "sector_number": current_sector_number,
            "sector_name":   current_sector_name,
            "item_no":       item_no,
            "tech_name":     name,
            "tech_description": desc,
        })

    return records


# ── 신성장원천기술 파서 ──────────────────────────────────────────
def parse_newgrowth(path, sector_order: dict):
    records = []
    current_sector_number = ""
    current_sector_name   = ""
    current_minor = ""
    pending = None

    def flush():
        nonlocal pending
        if pending is not None:
            records.append(pending)
            pending = None

    for tr in get_table_rows(path):
        cm = row_col_map(tr)

        if 0 in cm and cm[0].strip():
            _, name = split_sector(cm[0])   # 숫자 prefix 제거 후 이름만
            if not name:
                name = cm[0].strip()
            _nk = _norm_sector(name)
            if _nk not in sector_order:
                sector_order[_nk] = str(len(sector_order) + 1)
            current_sector_name   = name
            current_sector_number = sector_order[_nk]
        if 1 in cm:
            current_minor = cm[1].strip()

        if 2 not in cm or not cm[2]:
            continue

        raw = cm[2]
        m = NEW_ITEM_RE.match(raw)
        is_new_item = bool(m) or (1 in cm)

        if is_new_item:
            flush()
            item_no = (m.group(1) + ")") if m else None
            tech    = raw[m.end():].strip() if m else raw
            name, desc = split_name_desc(tech)
            pending = {
                "sector_number":    current_sector_number,
                "sector_name":      current_sector_name,
                "subsector":        current_minor,
                "item_no":          item_no,
                "tech_name":        name,
                "tech_description": desc,
            }
        else:
            if pending is not None:
                pending = {
                    **pending,
                    "tech_description": (pending["tech_description"] + " " + raw).strip(),
                }

    flush()
    return records


# ── 정렬 키 ────────────────────────────────────────────────────
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
        _norm_sector(row.get("sector_name", "")),
        _norm_sector(row.get("subsector", "")),
        _norm_sector(row.get("tech_name", "")),
    )


def collapse_duplicate_current_deletions(rows):
    """번호 이동 후 최종 폐지된 동일 기술은 최신 폐지행만 current로 둔다."""
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


# ── 버전별 diff 빌더 ────────────────────────────────────────────
def build_diff(parse_fn, folder, key_fn, data_fields, output_path):
    files = sorted(
        [(extract_version(f), os.path.join(folder, f))
         for f in os.listdir(folder) if f.endswith(".hwpx")],
        key=lambda x: x[0],
    )

    state = {}          # key → index in rows
    rows  = []
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
            desc = item["tech_description"]
            seen_keys.add(key)

            if key not in state:
                row = {f: item.get(f) for f in data_fields}
                row.update(version=version, current=True, status="신설")
                row["apply_date"] = compute_apply_date(version, item.get("sector_name", ""), "신설")
                rows.append(row)
                state[key] = len(rows) - 1
            else:
                prev = rows[state[key]]
                if name == prev["tech_name"] and desc == prev["tech_description"]:
                    continue          # 변경 없음
                prev["current"] = False
                is_del = name.startswith("삭제")
                status_val = "삭제" if is_del else "변경"
                # 삭제 행은 원래 기술명·설명 유지
                row = {f: prev.get(f) if is_del else item.get(f) for f in data_fields}
                row.update(version=version, current=True, status=status_val)
                row["apply_date"] = compute_apply_date(
                    version,
                    (prev if is_del else item).get("sector_name", ""),
                    status_val,
                )
                rows.append(row)
                state[key] = len(rows) - 1

        # 이번 버전에 나타나지 않은 current 항목 → 암묵적 삭제
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


def main():
    print("=== 국가전략기술 ===")
    build_diff(
        parse_fn    = parse_strategic,
        folder      = STRAT_DIR,
        key_fn      = make_key_strategic,
        data_fields = ["sector_number", "sector_name", "item_no", "tech_name", "tech_description"],
        output_path = STRAT_OUT,
    )

    print("=== 신성장원천기술 ===")
    build_diff(
        parse_fn    = parse_newgrowth,
        folder      = NEW_DIR,
        key_fn      = make_key_newgrowth,
        data_fields = ["sector_number", "sector_name", "subsector", "item_no", "tech_name", "tech_description"],
        output_path = NEW_OUT,
    )


if __name__ == "__main__":
    main()
