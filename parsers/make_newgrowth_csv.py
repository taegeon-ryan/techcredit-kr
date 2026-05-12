import zipfile
import xml.etree.ElementTree as ET
import csv
import re
import os
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
HWPX_PATH = os.path.join(_ROOT, "input", "tech", "newgrowth", "[별표 7] 신성장ㆍ원천기술의 범위(제9조제2항 관련)(조세특례제한법 시행령)_260227.hwpx")
OUTPUT_PATH = os.path.join(_ROOT, "output", "newgrowth_tech_latest.csv")

NS_HP = "http://www.hancom.co.kr/hwpml/2011/paragraph"

MAJOR_PREFIX_RE = re.compile(r"^\d+\.\s*")
MINOR_PREFIX_RE = re.compile(r"^[\uAC00-\uD7A3]\.\s*")
ITEM_PREFIX_RE  = re.compile(r"^\d+\)\s*")


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


def cell_text(tc):
    parts = []
    for t in tc.iter(f"{{{NS_HP}}}t"):
        if t.text:
            parts.append(t.text)
    return "".join(parts).strip()


def parse_hwpx(path):
    with zipfile.ZipFile(path) as z:
        with z.open("Contents/section0.xml") as f:
            root = ET.fromstring(f.read())

    tbl = next(root.iter(f"{{{NS_HP}}}tbl"))
    rows = list(tbl.iter(f"{{{NS_HP}}}tr"))

    records = []
    current_major = ""
    current_minor = ""
    pending = None

    def flush():
        nonlocal pending
        if pending is not None:
            records.append(pending)
            pending = None

    for ri, tr in enumerate(rows):
        if ri < 3:
            continue

        col_map = {}
        for tc in tr.findall(f"{{{NS_HP}}}tc"):
            addr = tc.find(f"{{{NS_HP}}}cellAddr")
            if addr is None:
                continue
            col = int(addr.get("colAddr", -1))
            col_map[col] = cell_text(tc)

        if 0 in col_map:
            txt = col_map[0]
            current_major = MAJOR_PREFIX_RE.sub("", txt).strip()

        if 1 in col_map:
            txt = col_map[1]
            current_minor = MINOR_PREFIX_RE.sub("", txt).strip()

        if 2 not in col_map:
            continue

        raw = col_map[2]
        if not raw:
            continue

        m = ITEM_PREFIX_RE.match(raw)
        # col1이 이 행에서 갱신됐다면 단독 기술 항목으로 처리
        is_new_item = bool(m) or (1 in col_map)
        if is_new_item:
            flush()
            tech = raw[m.end():].strip() if m else raw
            colon = find_desc_separator(tech)
            if colon != -1:
                name = tech[:colon].strip()
                desc = tech[colon + 1:].strip()
            else:
                name = tech
                desc = ""
            pending = (current_major, current_minor, name, desc)
        else:
            if pending is not None:
                pending = (pending[0], pending[1], pending[2],
                           (pending[3] + " " + raw).strip())

    flush()
    return records


def main():
    records = parse_hwpx(HWPX_PATH)
    records = [(maj, min_, name, desc) for maj, min_, name, desc in records
               if "삭제" not in name]
    with open(OUTPUT_PATH, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["index", "sector", "subsector", "tech_name", "tech_description"])
        for i, (major, minor, name, desc) in enumerate(records, start=1):
            writer.writerow([i, major, minor, name, desc])
    print(f"Done: {OUTPUT_PATH} ({len(records)} rows)")
    for r in records:
        print(r)


if __name__ == "__main__":
    main()
