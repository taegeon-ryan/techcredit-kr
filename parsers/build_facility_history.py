import zipfile
import xml.etree.ElementTree as ET
import csv
import re
import os
import sys
import unicodedata
from datetime import date, timedelta
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from build_tech_history import (
    STRATEGIC_SECTOR_NO, NEWGROWTH_SECTOR_NO, resolve_sector_no,
    _canonicalize_sector_names, collect_name_changes, _euro, _tidy_name, _move_note,
)

# 비교 전용 정규화: 시각적으로 동일한 기호 변이를 하나로 통일 (쉼표 등 의미 있는 구두점은 보존)
#   중간점/점류 → · : 00B7· 0387· 2022• 2024․ 2027‧ 2219∙ 22C5⋅ 30FB・ FF65･ 318Dㆍ 119Eᆞ
#   대시/하이픈류 → - : 002D- 2010‐ 2011‑ 2012‒ 2013– 2014— 2015― 2212− FF0D－
_MIDDOT_RE = re.compile("[\u00B7\u0387\u2022\u2024\u2027\u2219\u22C5\u30FB\uFF65\u318D\u119E]")
_DASH_RE = re.compile("[\u002D\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFF0D]")
_TILDE_RE = re.compile("[\u007E\u223C\u301C\uFF5E\u2053]")  # ~ ∼ 〜 ～ ⁓ → ~

def _norm_compare(s: str) -> str:
    """변경 감지 비교 전용 정규화. 저장·표시값은 그대로 두고 이 키로만 비교한다.
    점류·대시류 통일 → NFKC(전각/반각·합성문자) → 모든 공백 제거.
    NFKC가 기호를 분해해 흩어지므로 NFKC '전에' 통일한다."""
    if not s:
        return ""
    s = _MIDDOT_RE.sub("\u00B7", s)
    s = _DASH_RE.sub("-", s)
    s = _TILDE_RE.sub("~", s)
    s = unicodedata.normalize("NFKC", s)
    s = s.translate(_BRACKET_TABLE)
    return re.sub(r"\s+", "", s)

# 괄호 변이 통일: [ ] { } → ( )  (NFKC 후 ASCII 기준)
_BRACKET_TABLE = str.maketrans("[]{}", "()()")

# 어미 축약 표현 쌍 (통하여↔통해 등) — 변경으로 두되 '표현 정비' 비고를 단다
_WORDING_PAIRS = [("통하여", "통해"), ("위하여", "위해")]

def _norm_full(s):
    """_norm_compare + 어미 표현 통일 — '표현 정비'(어미만 다른) 변경 판별용."""
    s = _norm_compare(s)
    for full, short in _WORDING_PAIRS:
        s = s.replace(full, short)
    return s

def _wording_diff(old, new):
    """두 텍스트 사이에 달라진 어미 표현을 'A→B' 문자열로."""
    parts = []
    for full, short in _WORDING_PAIRS:
        do, dn = old.count(full), new.count(full)
        if do != dn:
            parts.append(f"'{full}'→'{short}'" if do > dn else f"'{short}'→'{full}'")
    return ", ".join(parts)


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

# 데이터셋별 적용연월 override: (dataset, version) → (년, 월)
DATASET_APPLY_OVERRIDE = {
    # 국가전략기술 제도는 2021-07-01부터 소급 적용 (사업화시설 별표 6의2 최초 신설은 220318 개정)
    ("strategic", "220318"): (2021, 7),
}

NS_HP = "http://www.hancom.co.kr/hwpml/2011/paragraph"

STRAT_ITEM_RE = re.compile(r"^([\uAC00-\uD7A3])\.\s*")
NEW_ITEM_RE   = re.compile(r"^(\d+)\)\s*")


# ── 공통 유틸 ──────────────────────────────────────────────────────────
def compute_apply_date(version: str, sector_name: str, status: str,
                       dataset: str = "") -> str:
    ym = (APPLY_OVERRIDE.get((version, sector_name))
          or DATASET_APPLY_OVERRIDE.get((dataset, version))
          or APPLY_MAP.get(version))
    if not ym:
        return ""
    first_day = date(ym[0], ym[1], 1)
    eff = (first_day - timedelta(days=1)) if status == "삭제" else first_day
    return eff.strftime("%Y-%m-%d")


def cell_text(tc):
    # <hp:t> 안의 <hp:lineBreak/> 뒤 텍스트(tail)까지 포함 — itertext 사용
    # (t.text 만 쓰면 줄바꿈 뒤 글자가 누락됨: 예 '발전<lineBreak/>시스템' → '발전')
    return "".join("".join(t.itertext()) for t in tc.iter(f"{{{NS_HP}}}t")).strip()


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


def _canonicalize_subsector_names(rows, latest):
    """latest: {(sector_number, prefix): 최신 소분류명} (전 버전 items 기준)."""
    for r in rows:
        ss = r.get("subsector") or ""
        if not ss:
            continue
        key = (r.get("sector_number"), _kor_prefix(ss))
        if key in latest:
            r["subsector"] = latest[key]


# 한글 열거기호(가나다…하 거너더…) 순서
_CHO_ORDER  = {0: 0, 2: 1, 3: 2, 5: 3, 6: 4, 7: 5, 9: 6,
               11: 7, 12: 8, 14: 9, 15: 10, 16: 11, 17: 12, 18: 13}
_JUNG_ORDER = {0: 0, 4: 1, 8: 2, 13: 3, 18: 4, 20: 5}

def _kor_marker_order(ch):
    """가나다 열거 순서 인덱스. 비표준이면 큰 값."""
    if not ch or not ("가" <= ch <= "힣"):
        return 9999
    code = ord(ch) - 0xAC00
    cho, jung, jong = code // 588, (code % 588) // 28, code % 28
    if jong != 0 or cho not in _CHO_ORDER or jung not in _JUNG_ORDER:
        return 9000 + ord(ch)
    return _JUNG_ORDER[jung] * 14 + _CHO_ORDER[cho]



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
    """sector_number → 소분류 prefix → item_no → version 순 오름차순.
    소분류명 전체가 아닌 가나다 prefix로 묶어, 개명으로 옛 이름을 단 행이
    형제와 분리돼 index가 뒤섞이는 것을 방지한다."""
    try:
        sn = int(r.get("sector_number") or 0)
    except (ValueError, TypeError):
        sn = 0
    ss  = _kor_prefix(r.get("subsector") or "")
    ss_key = (_kor_marker_order(ss), ss)
    ino = (r.get("item_no") or "").strip()
    m   = re.match(r"^(\d+)\)$", ino)
    m2  = re.match(r"^([가-힣])\.?$", ino)
    if m:
        ino_key = (0, int(m.group(1)), 0, "")
    elif m2:
        ino_key = (1, 0, _kor_marker_order(m2.group(1)), "")
    elif ino:
        ino_key = (2, 0, 0, ino)
    else:
        ino_key = (-1, 0, 0, "")
    return (sn, ss_key, ino_key, r.get("version", ""))


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
def build_diff(parse_fn, folder, key_fn, data_fields, output_path, dataset=""):
    files = sorted(
        [(extract_version(f), os.path.join(folder, f))
         for f in os.listdir(folder) if f.endswith(".hwpx")],
        key=lambda x: x[0],
    )

    state        = {}   # key → index in rows
    rows         = []
    sector_order = {}   # 전 버전 공유 sector_name → number
    sector_latest = {}
    subsec_latest = {}
    sector_perver = {}
    subsec_perver = {}

    for version, path in files:
        fname = os.path.basename(path)
        try:
            items = parse_fn(path, sector_order)
        except Exception as e:
            print(f"  SKIP {fname}: {e}")
            continue

        # 분야 번호를 canonical 로 재지정 (매칭 전 → 개명 분야 병합·연혁 보존, 비고/미등록 스킵)
        _smap = STRATEGIC_SECTOR_NO if dataset == "strategic" else NEWGROWTH_SECTOR_NO
        _canon = []
        for it in items:
            num = resolve_sector_no(it.get("sector_name", ""), _smap)
            if num is None:
                continue
            it["sector_number"] = num
            _canon.append(it)
        items = _canon

        print(f"  v{version}: {len(items)}항목 파싱")

        for _it in items:
            _sn = _it.get("sector_number")
            if not _sn:
                continue
            _nm = _it.get("sector_name", "")
            _ad = compute_apply_date(version, _nm, "신설", dataset)
            if _sn not in sector_latest or version > sector_latest[_sn][0]:
                sector_latest[_sn] = (version, _nm)
            sector_perver.setdefault(_sn, {}).setdefault(version, (_ad, _nm))
            _ss = _it.get("subsector", "")
            if _ss:
                _sk = (_sn, _kor_prefix(_ss))
                if _sk not in subsec_latest or version > subsec_latest[_sk][0]:
                    subsec_latest[_sk] = (version, _ss)
                subsec_perver.setdefault(_sk, {}).setdefault(version, (_ad, _ss))

        seen_keys = set()

        for item in items:
            key  = key_fn(item)
            name = item["tech_name"]
            desc = item["facility_description"]
            seen_keys.add(key)

            if key not in state:
                row = {f: item.get(f) for f in data_fields}
                row.update(version=version, current=True, status="신설")
                row["apply_date"] = compute_apply_date(version, item.get("sector_name", ""), "신설", dataset)
                rows.append(row)
                state[key] = len(rows) - 1
            else:
                prev = rows[state[key]]
                if (_norm_compare(name) == _norm_compare(prev["tech_name"])
                        and _norm_compare(desc) == _norm_compare(prev["facility_description"])):
                    continue  # 변경 없음 (기호·공백 변이 무시)
                is_del     = name.startswith("삭제")
                if is_del and prev["status"] == "삭제":
                    continue  # 이미 삭제됨 → 개정마다 반복 삭제행 생성 방지
                prev["current"] = False
                status_val = "삭제" if is_del else "변경"
                row = {f: prev.get(f) if is_del else item.get(f) for f in data_fields}
                row.update(version=version, current=True, status=status_val)
                row["apply_date"] = compute_apply_date(
                    version,
                    (prev if is_del else item).get("sector_name", ""),
                    status_val,
                    dataset,
                )
                if (not is_del
                        and _norm_full(name) == _norm_full(prev["tech_name"])
                        and _norm_full(desc) == _norm_full(prev["facility_description"])):
                    _wd = _wording_diff(
                        (prev.get("tech_name") or "") + " " + (prev.get("facility_description") or ""),
                        (name or "") + " " + (desc or ""))
                    if _wd:
                        row["_wording_note"] = f"{row['apply_date']} 표현 정비: " + _wd
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
                    version, prev.get("sector_name", ""), "삭제", dataset
                )
                rows.append(new_row)
                state[key] = len(rows) - 1

    # 개명 이력(비고) — 정규화 전에 수집
    sec_changes = collect_name_changes(sector_perver, "분야")
    sub_changes = collect_name_changes(subsec_perver, "소분류")
    # 이동 비고용: 정규화 기술명 → 최초 등장 위치 (정규화 전 원본 분야/소분류명, 비삭제 최소버전)
    name_origin = {}
    for r in rows:
        if r.get("status") == "삭제":
            continue
        k = _norm_compare(r.get("tech_name", ""))
        if not k:
            continue
        v = r.get("version", "")
        if k not in name_origin or v < name_origin[k][0]:
            name_origin[k] = (v, r.get("sector_number"), r.get("sector_name", ""),
                              r.get("subsector", ""), r.get("item_no", ""))

    _canonicalize_sector_names(rows, {n: _tidy_name(nm) for n, (v, nm) in sector_latest.items()})
    _canonicalize_subsector_names(rows, {k: _tidy_name(nm) for k, (v, nm) in subsec_latest.items()})

    sec_note = {}
    for sec, _pfx, note in sec_changes:
        sec_note.setdefault(sec, []).append(note)
    sub_note = {}
    for sec, pfx, note in sub_changes:
        sub_note.setdefault((sec, pfx), []).append(note)

    # 현행 활성 위치 (정규화명 → (분야, 분야명, 소분류, item, 적용일))
    active_full = {}
    for r in rows:
        if r.get("current") and r.get("status") != "삭제":
            k = _norm_compare(r.get("tech_name", ""))
            if k and k not in active_full:
                active_full[k] = (r.get("sector_number"), r.get("sector_name", ""),
                                  r.get("subsector", ""), r.get("item_no", ""), r.get("apply_date", ""))

    # 이동 비고: 최초 위치(name_origin) → 현행 활성 위치를 한 형식으로 (출발·도착 양쪽 동일)
    move_note = {}
    for k, a in active_full.items():
        orig = name_origin.get(k)
        if orig:
            mv = _move_note(a[4], orig[1], orig[2], orig[3], orig[4], a[0], a[1], a[2], a[3])
            if mv:
                move_note[k] = mv

    # (정규화명, 분야, prefix, item) → 최신행 — 떠난 슬롯 대표행에만 이동 비고
    latest_at = {}
    for r in rows:
        k = _norm_compare(r.get("tech_name", ""))
        slot = (k, r.get("sector_number"), _kor_prefix(r.get("subsector", "")), r.get("item_no", ""))
        if slot not in latest_at or r.get("version", "") > latest_at[slot].get("version", ""):
            latest_at[slot] = r

    for r in rows:
        notes = []
        k = _norm_compare(r.get("tech_name", ""))
        r_sec = r.get("sector_number"); r_pfx = _kor_prefix(r.get("subsector", "")); r_item = r.get("item_no", "")
        a = active_full.get(k)
        if r.get("current") and r.get("status") != "삭제":
            notes += sec_note.get(r_sec, [])
            notes += sub_note.get((r_sec, r_pfx), [])
            if r.get("_wording_note"):
                notes.append(r["_wording_note"])
            if k in move_note:
                notes.append(move_note[k])
        else:
            if (a and (a[0], _kor_prefix(a[2]), a[3]) != (r_sec, r_pfx, r_item)
                    and latest_at.get((k, r_sec, r_pfx, r_item)) is r
                    and k in move_note):
                notes.append(move_note[k])
        r["note"] = " / ".join(notes)

    collapse_duplicate_current_deletions(rows)

    rows.sort(key=_row_sort_key)
    for i, row in enumerate(rows, 1):
        row["index"] = i

    fieldnames = ["index"] + data_fields + ["version", "apply_date", "status", "current", "note"]
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
                strat_keys.add((r["sector_number"], r["item_no"]))

    with open(NEW_FAC_OUT, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            if r.get("current") == "True":
                new_keys.add((r["sector_number"], _kor_prefix(r["subsector"]), r["item_no"]))

    def _update(tech_csv, key_fn, fac_keys):
        with open(tech_csv, encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            fieldnames = reader.fieldnames
            rows = list(reader)

        if "has_facility" not in fieldnames:
            fieldnames = fieldnames + ["has_facility"]
        # 비고(note)는 항상 맨 끝 열로 유지
        if "note" in fieldnames:
            fieldnames = [c for c in fieldnames if c != "note"] + ["note"]

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
        lambda r: (r["sector_number"], r["item_no"]),
        strat_keys,
    )
    _update(
        NEW_TECH_CSV,
        lambda r: (r["sector_number"], _kor_prefix(r["subsector"]), r["item_no"]),
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
        dataset     = "strategic",
    )

    print("=== 신성장원천기술 사업화시설 ===")
    build_diff(
        parse_fn    = parse_newgrowth_facility,
        folder      = NEW_FAC_DIR,
        key_fn      = make_key_newgrowth,
        data_fields = ["sector_number", "sector_name", "subsector", "item_no",
                       "tech_name", "facility_description"],
        output_path = NEW_FAC_OUT,
        dataset     = "newgrowth",
    )

    print("=== tech CSV has_facility 업데이트 ===")
    add_has_facility()


if __name__ == "__main__":
    main()
