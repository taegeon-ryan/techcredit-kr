import zipfile
import xml.etree.ElementTree as ET
import csv
import re
import os
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
HWPX_PATH = os.path.join(_ROOT, "input", "tech", "strategic", "[별표 7의2] 국가전략기술의 범위(제9조제6항 관련)(조세특례제한법 시행령)_260227.hwpx")
OUTPUT_PATH = os.path.join(_ROOT, "output", "strategic_tech_latest.csv")

NS_HP = "http://www.hancom.co.kr/hwpml/2011/paragraph"

SECTOR_NUM_RE  = re.compile(r"^\d+\.\s*")
ITEM_PREFIX_RE = re.compile(r"^[\uAC00-\uD7A3]\.\s*")


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
    current_sector = ""

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
            current_sector = SECTOR_NUM_RE.sub("", txt).strip()

        if 1 not in col_map:
            continue

        raw = col_map[1]
        if not raw:
            continue

        m = ITEM_PREFIX_RE.match(raw)
        tech = raw[m.end():].strip() if m else raw

        colon = find_desc_separator(tech)
        if colon != -1:
            name = tech[:colon].strip()
            desc = tech[colon + 1:].strip()
        else:
            name = tech
            desc = ""

        records.append((current_sector, name, desc))

    return records


def main():
    records = parse_hwpx(HWPX_PATH)
    with open(OUTPUT_PATH, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["index", "sector", "tech_name", "tech_description"])
        for i, (sector, name, desc) in enumerate(records, start=1):
            writer.writerow([i, sector, name, desc])
    print(f"Done: {OUTPUT_PATH} ({len(records)} rows)")
    for r in records:
        print(r)


if __name__ == "__main__":
    main()
