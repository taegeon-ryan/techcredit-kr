import zipfile
import xml.etree.ElementTree as ET
import csv
import re
import os
import sys
import unicodedata
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

# 데이터셋별 적용연월 override: (dataset, version) → (년, 월)
# 같은 개정일이라도 데이터셋(전략/신성장)마다 적용시기가 다른 경우
DATASET_APPLY_OVERRIDE = {
    # 국가전략기술 제도는 2021-07-01부터 소급 적용 (별표 7의2 최초 신설은 220215 개정)
    ("strategic", "220215"): (2021, 7),
}


def compute_apply_date(version: str, sector_name: str, status: str,
                       dataset: str = "") -> str:
    """
    신설/변경 → 적용연월 첫째날 (YYYY-MM-DD)
    삭제      → 적용연월 전달 말일 (해당 규정이 유효한 마지막 날)
    """
    ym = (APPLY_OVERRIDE.get((version, sector_name))
          or DATASET_APPLY_OVERRIDE.get((dataset, version))
          or APPLY_MAP.get(version))
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



def _sector_no_map(pairs):
    """[(번호, [이름변형들])] → {정규화명: 번호}. 가운뎃점·공백 변이는 _norm_sector가 흡수."""
    d = {}
    for num, names in pairs:
        for nm in names:
            d[_norm_sector(nm)] = num
    return d

# 분야 확정 번호 (정규화명 → 번호). 개명 전후 이름을 같은 번호로 합쳐 기술 연혁을 보존.
# 표시 이름은 빌드 후 최신 버전 이름으로 통일(_canonicalize_sector_names).
STRATEGIC_SECTOR_NO = _sector_no_map([
    (1, ["반도체"]), (2, ["이차전지"]), (3, ["백신"]), (4, ["디스플레이"]),
    (5, ["수소"]),
    (6, ["미래형 이동수단", "미래형 운송 및 이동수단"]),   # 개명 병합
    (7, ["바이오의약품"]), (8, ["인공지능"]),
])
NEWGROWTH_SECTOR_NO = _sector_no_map([
    (1, ["미래형자동차"]), (2, ["지능정보"]),
    (3, ["차세대SW(소프트웨어) 및 보안", "차세대소프트웨어(SW) 및 보안"]),   # 개명 병합
    (4, ["콘텐츠"]), (5, ["차세대전자정보 디바이스"]), (6, ["차세대 방송통신"]),
    (7, ["바이오·헬스"]),
    (8, ["에너지신산업·환경", "에너지 신·환경", "에너지·환경"]),   # 개명 병합 (탄소중립은 별개 분야)
    (9, ["융복합소재"]), (10, ["로봇"]), (11, ["항공·우주"]),
    (12, ["첨단 소재·부품·장비"]), (13, ["탄소중립"]), (14, ["방위산업"]),
])

def resolve_sector_no(name, sector_no_map):
    """분야명 → 확정 번호(str). 비고 각주/미등록 분야는 None(스킵)."""
    if not name or name.startswith("비고"):
        return None
    num = sector_no_map.get(_norm_sector(name))
    if num is None:
        print(f"  [WARN] 미등록 분야명 (canonical 맵에 추가 필요): {name!r}")
        return None
    return str(num)


def _canonicalize_sector_names(rows, latest):
    """latest: {sector_number: 최신 분야명} (변경 없는 버전 포함 전 버전 items 기준).
    개명으로 갈라진 옛 이름을 현행명으로 합쳐 대시보드가 한 분야로 묶도록 한다."""
    for r in rows:
        n = r.get("sector_number")
        if n in latest:
            r["sector_name"] = latest[n]


def _canonicalize_subsector_names(rows, latest):
    """latest: {(sector_number, prefix): 최신 소분류명} (전 버전 items 기준)."""
    for r in rows:
        ss = r.get("subsector") or ""
        if not ss:
            continue
        key = (r.get("sector_number"), _kor_prefix(ss))
        if key in latest:
            r["subsector"] = latest[key]



# 개명 이력(비고) 수집: 이름은 현행으로 통일하되 변경 내역을 별도 기록
def _euro(word):
    """받침에 맞춘 '(으)로' 조사."""
    if not word or not ("가" <= word[-1] <= "힣"):
        return "으로"
    jong = (ord(word[-1]) - 0xAC00) % 28
    return "로" if jong in (0, 8) else "으로"

def _tidy_name(s):
    """가운뎃점 좌우 공백 제거: '에너지 ㆍ환경' → '에너지ㆍ환경' (분야/소분류 표시 정리)."""
    return re.sub(r"\s*([ㆍ·])\s*", r"\1", s or "")

def _move_note(date, o_sec, o_name, o_sub, o_item, d_sec, d_name, d_sub, d_item):
    """이동 비고를 '{출발}에서 {목적지}(으)로 이동' 한 형식으로. 번호 없으면 위치이동 생략."""
    if (o_sec, _kor_prefix(o_sub)) == (d_sec, _kor_prefix(d_sub)):
        # 같은 소분류 내 번호 이동
        if o_item == d_item:
            return None   # 동일 위치 → 이동 아님
        if o_item and d_item:
            return f"{date} 같은 소분류 {o_item}에서 {d_item} 위치로 이동"
        return f"{date} 같은 소분류 내 위치 이동"   # 번호 없는 항목
    o_str = f"{o_sec}. {_tidy_name(o_name)} - {_tidy_name(o_sub)}" if o_sub else f"{o_sec}. {_tidy_name(o_name)}"
    d_str = f"{d_sec}. {_tidy_name(d_name)} - {_tidy_name(d_sub)}" if d_sub else f"{d_sec}. {_tidy_name(d_name)}"
    return f"{date} {o_str}에서 {d_str}{_euro(d_str)} 이동"

def collect_name_changes(perver, level):
    """개명 이력 추출. perver: {group: {version: (apply_date, name)}} (전 버전 items 기준).
    level: '분야' 또는 '소분류'. group 은 분야번호(분야) 또는 (분야번호, prefix)(소분류)."""
    changes = []   # (sector_number, subsector_prefix, note)
    for g, vmap in perver.items():
        prev_norm = prev_name = None
        for v in sorted(vmap):
            ad, nm = vmap[v]
            n = _norm_sector(nm)
            if prev_norm is not None and n != prev_norm:
                sec = g[0] if isinstance(g, tuple) else g
                pfx = g[1] if isinstance(g, tuple) else ""
                note = f"{ad} '{prev_name}'에서 '{nm}'{_euro(nm)} {level}명 변경"
                changes.append((sec, pfx, note))
            prev_norm, prev_name = n, nm
    return changes


# 한글 열거기호(가나다…하 거너더…) 순서 — 자음 14개 × 모음 라운드(ㅏㅓㅗㅜㅡㅣ)
_CHO_ORDER  = {0: 0, 2: 1, 3: 2, 5: 3, 6: 4, 7: 5, 9: 6,
               11: 7, 12: 8, 14: 9, 15: 10, 16: 11, 17: 12, 18: 13}
_JUNG_ORDER = {0: 0, 4: 1, 8: 2, 13: 3, 18: 4, 20: 5}

def _kor_marker_order(ch):
    """'가'→0 '나'→1 … '하'→13 '거'→14 '너'→15 …  비표준이면 큰 값."""
    if not ch or not ("가" <= ch <= "힣"):
        return 9999
    code = ord(ch) - 0xAC00
    cho, jung, jong = code // 588, (code % 588) // 28, code % 28
    if jong != 0 or cho not in _CHO_ORDER or jung not in _JUNG_ORDER:
        return 9000 + ord(ch)
    return _JUNG_ORDER[jung] * 14 + _CHO_ORDER[cho]


STRAT_SECTOR_RE = re.compile(r"^\d+\.\s*")
STRAT_ITEM_RE   = re.compile(r"^([\uAC00-\uD7A3])\.\s*")
NEW_MAJOR_RE    = re.compile(r"^\d+\.\s*")
NEW_MINOR_RE    = re.compile(r"^[\uAC00-\uD7A3]\.\s*")
NEW_ITEM_RE     = re.compile(r"^(\d+)\)\s*")


def cell_text(tc):
    # <hp:t> 안의 <hp:lineBreak/> 뒤 텍스트(tail)까지 포함 — itertext 사용
    # (t.text 만 쓰면 줄바꿈 뒤 글자가 누락됨: 예 '발전<lineBreak/>시스템' → '발전')
    return "".join("".join(t.itertext()) for t in tc.iter(f"{{{NS_HP}}}t")).strip()


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
            num = resolve_sector_no(name, STRATEGIC_SECTOR_NO)   # 비고/미등록 → None
            current_sector_number = num
            if num is not None:
                current_sector_name = name

        if current_sector_number is None:       # 비고 각주 등 스킵
            continue
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
            num = resolve_sector_no(name, NEWGROWTH_SECTOR_NO)   # 비고/미등록 → None
            current_sector_number = num
            if num is not None:
                current_sector_name = name
        if 1 in cm:
            current_minor = cm[1].strip()

        if current_sector_number is None:      # 비고 각주 등 스킵
            continue
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
    """sector_number → 소분류 prefix → item_no → version 순 오름차순.
    소분류명 전체가 아닌 가나다 prefix로 묶어, 개명으로 옛 이름을 단 행이
    형제와 분리돼 index가 뒤섞이는 것을 방지한다."""
    try:
        sn = int(r.get("sector_number") or 0)
    except (ValueError, TypeError):
        sn = 0
    ss  = _kor_prefix(r.get("subsector") or "")
    ss_key = (_kor_marker_order(ss), ss)          # 소분류 prefix 한글 열거순
    ino = (r.get("item_no") or "").strip()
    m   = re.match(r"^(\d+)\)$", ino)
    m2  = re.match(r"^([가-힣])\.?$", ino)
    if m:                                          # 숫자 항목 1) 2) …
        ino_key = (0, int(m.group(1)), 0, "")
    elif m2:                                        # 한글 항목 가. 나. …
        ino_key = (1, 0, _kor_marker_order(m2.group(1)), "")
    elif ino:
        ino_key = (2, 0, 0, ino)
    else:
        ino_key = (-1, 0, 0, "")
    return (sn, ss_key, ino_key, r.get("version", ""))


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
def build_diff(parse_fn, folder, key_fn, data_fields, output_path, dataset=""):
    files = sorted(
        [(extract_version(f), os.path.join(folder, f))
         for f in os.listdir(folder) if f.endswith(".hwpx")],
        key=lambda x: x[0],
    )

    state = {}          # key → index in rows
    rows  = []
    sector_order = {}   # 전 버전 공유 sector_name → number
    sector_latest = {}  # sector_number → (version, 분야명) — 변경없는 버전 포함
    subsec_latest = {}  # (sector_number, prefix) → (version, 소분류명)
    sector_perver = {}  # sector_number → {version: (apply_date, 분야명)}
    subsec_perver = {}  # (sector_number, prefix) → {version: (apply_date, 소분류명)}

    for version, path in files:
        fname = os.path.basename(path)
        try:
            items = parse_fn(path, sector_order)
        except Exception as e:
            print(f"  SKIP {fname}: {e}")
            continue

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
            desc = item["tech_description"]
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
                        and _norm_compare(desc) == _norm_compare(prev["tech_description"])):
                    continue          # 변경 없음 (기호·공백 변이 무시)
                is_del = name.startswith("삭제")
                if is_del and prev["status"] == "삭제":
                    continue          # 이미 삭제됨 → 개정마다 반복 삭제행 생성 방지
                prev["current"] = False
                status_val = "삭제" if is_del else "변경"
                # 삭제 행은 원래 기술명·설명 유지
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
                        and _norm_full(desc) == _norm_full(prev["tech_description"])):
                    _wd = _wording_diff(
                        (prev.get("tech_name") or "") + " " + (prev.get("tech_description") or ""),
                        (name or "") + " " + (desc or ""))
                    if _wd:
                        row["_wording_note"] = f"{row['apply_date']} 표현 정비: " + _wd
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


def add_cross_promotion_notes():
    """신성장↔국가전략 간 상향/이동: 한쪽에서 삭제된 기술명이 다른쪽에 현행으로 있으면
    삭제행 비고에 '국가전략기술 - N. OO로 이동' (또는 반대) 기록. 두 CSV 생성 후 호출."""
    def load(p):
        with open(p, encoding="utf-8-sig") as fh:
            return list(csv.DictReader(fh))
    strat = load(STRAT_OUT)
    new   = load(NEW_OUT)

    def active_index(rows):
        idx = {}
        for r in rows:
            if r.get("current") == "True" and r.get("status") != "삭제":
                k = _norm_compare(r.get("tech_name", ""))
                if k and k not in idx:
                    idx[k] = r            # 활성 행 자체 (양쪽 비고용)
        return idx

    strat_active, new_active = active_index(strat), active_index(new)

    def _append(row, note):
        row["note"] = (row["note"] + " / " + note) if row.get("note") else note

    def _loc(row, label):
        sub = row.get("subsector", "")
        if sub:
            return f"{label} {row['sector_number']}. {_tidy_name(row['sector_name'])} - {_tidy_name(sub)}"
        return f"{label} {row['sector_number']}. {_tidy_name(row['sector_name'])}"

    def annotate(del_rows, other_active, from_label, to_label):
        """del_rows(삭제) ↔ other_active(활성) 양쪽에 동일한 '{출발}에서 {목적지}로 이동' 비고."""
        n = 0
        for r in del_rows:
            if r.get("current") == "True" and r.get("status") == "삭제":
                dr = other_active.get(_norm_compare(r.get("tech_name", "")))
                if dr:
                    src = _loc(r, from_label)
                    dst = _loc(dr, to_label)
                    note = f"{dr.get('apply_date', '')} {src}에서 {dst}{_euro(dst)} 이동"
                    _append(r, note)
                    _append(dr, note)
                    n += 1
        return n

    c1 = annotate(new, strat_active, "신성장·원천기술", "국가전략기술")
    c2 = annotate(strat, new_active, "국가전략기술", "신성장·원천기술")

    for path, rows in [(STRAT_OUT, strat), (NEW_OUT, new)]:
        with open(path, "w", newline="", encoding="utf-8-sig") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()), extrasaction="ignore")
            w.writeheader(); w.writerows(rows)
    print(f"  크로스 이동 비고: 신성장→전략 {c1}건, 전략→신성장 {c2}건")


def main():
    print("=== 국가전략기술 ===")
    build_diff(
        parse_fn    = parse_strategic,
        folder      = STRAT_DIR,
        key_fn      = make_key_strategic,
        data_fields = ["sector_number", "sector_name", "item_no", "tech_name", "tech_description"],
        output_path = STRAT_OUT,
        dataset     = "strategic",
    )

    print("=== 신성장원천기술 ===")
    build_diff(
        parse_fn    = parse_newgrowth,
        folder      = NEW_DIR,
        key_fn      = make_key_newgrowth,
        data_fields = ["sector_number", "sector_name", "subsector", "item_no", "tech_name", "tech_description"],
        output_path = NEW_OUT,
        dataset     = "newgrowth",
    )

    print("=== 신성장↔국가전략 상향/이동 비고 ===")
    add_cross_promotion_notes()


if __name__ == "__main__":
    main()
