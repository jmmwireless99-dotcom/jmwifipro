#!/usr/bin/env python3
"""EasyEDA Standard schematic: 8x 2.5GBASE-T PoE+ and 4x 10G SFP+.

Reference design. The RTL9313 switch is a functional symbol (Realtek BGA
ballout is not public). RTL8221B and TPS23881 use published pin numbers.
Open the project JSON with EasyEDA Standard: File -> Open -> EasyEDA Source.
"""

from __future__ import annotations

import json
import os
import uuid
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "easyeda", "POE_SW_8x2G5_4xSFP.json")
BOM = os.path.join(ROOT, "bom", "BOM.csv")
NET = os.path.join(ROOT, "bom", "netlist-summary.txt")
PREVIEW = os.path.join(ROOT, "preview")
# Stub from a pin dot to the net flag. Pin numbers sit in this gap.
STUB = 26


class Sch:
    def __init__(self, title, project):
        self.title = title
        self.p = project
        self.shapes = []
        self.draw = []
        self.pins = {}
        self.pin_net = {}
        self.flag_at = []
        self.flag_boxes = []
        self.body_boxes = []
        self.wire_ends = []
        self.minx = 10**9
        self.miny = 10**9
        self.maxx = -10**9
        self.maxy = -10**9

    def gid(self):
        return self.p.gid()

    def touch(self, x, y):
        self.minx = min(self.minx, x)
        self.miny = min(self.miny, y)
        self.maxx = max(self.maxx, x)
        self.maxy = max(self.maxy, y)

    def part(self, ref, value, package, mpn, desc, lcsc=""):
        self.p.parts.append(
            {
                "sheet": self.title,
                "ref": ref,
                "value": value,
                "package": package,
                "mpn": mpn,
                "lcsc": lcsc,
                "description": desc,
            }
        )

    def note(self, x, y, text, size=11, color="#333333"):
        self.touch(x, y)
        self.touch(x + 8 * len(text), y + 14)
        self.shapes.append(
            f"T~L~{x}~{y}~0~{color}~Arial~{size}pt~~~~comment~{text}~1~start~{self.gid()}~0"
        )
        self.draw.append(("t", x, y, text, size, color))

    def rect(self, x, y, w, h, color="#888888"):
        self.touch(x, y)
        self.touch(x + w, y + h)
        self.shapes.append(
            f"R~{x}~{y}~~~{w}~{h}~{color}~1~0~none~{self.gid()}~0~"
        )
        self.draw.append(("r", x, y, w, h, color))

    def wire(self, pts):
        for x, y in pts:
            self.touch(x, y)
        self.wire_ends.append(pts[0])
        self.wire_ends.append(pts[-1])
        body = " ".join(f"{x} {y}" for x, y in pts)
        self.shapes.append(f"W~{body}~#008800~1~0~none~{self.gid()}~0")
        self.draw.append(("w", pts))

    def _flag_gnd(self, x, y, text_side="R"):
        self.touch(x - 40, y)
        self.touch(x + 40, y + 22)
        self.flag_at.append((x, y, "GND"))
        if text_side == "L":
            self.flag_boxes.append((x - 36, y, x + 10, y + 18, "GND"))
            label_x = x - 34
            align = "end"
        else:
            self.flag_boxes.append((x - 10, y, x + 36, y + 18, "GND"))
            label_x = x + 8
            align = "start"
        self.shapes.append(
            f"F~part_netLabel_gnD~{x}~{y}~0~{self.gid()}~~0"
            f"^^{x}~{y}"
            f"^^GND~#000000~{label_x}~{y + 20}~0~{align}~1~Times New Roman~9pt~{self.gid()}"
            f"^^PL~{x} {y} {x} {y + 8}~#000000~1~0~transparent~{self.gid()}~0"
            f"^^PL~{x - 9} {y + 8} {x + 9} {y + 8}~#000000~1~0~transparent~{self.gid()}~0"
            f"^^PL~{x - 6} {y + 10} {x + 6} {y + 10}~#000000~1~0~transparent~{self.gid()}~0"
            f"^^PL~{x - 3} {y + 12} {x + 3} {y + 12}~#000000~1~0~transparent~{self.gid()}~0"
            f"^^PL~{x - 1} {y + 14} {x + 1} {y + 14}~#000000~1~0~transparent~{self.gid()}~0"
        )
        self.draw.append(("gnd", x, y, text_side))

    def _flag_net(self, x, y, name, direction):
        span = max(36, 7 * len(name) + 16)
        if direction == "L":
            self.touch(x - span - 8, y - 10)
            self.touch(x, y + 10)
            pl = f"{x} {y} {x - 6} {y - 6} {x - span} {y - 6} {x - span} {y + 6} {x - 6} {y + 6} {x} {y}"
            label = f"{name}~#0000FF~{x - span + 4}~{y - 8}~0~start~1~Times New Roman~8pt~{self.gid()}"
        else:
            self.touch(x, y - 10)
            self.touch(x + span + 8, y + 10)
            pl = f"{x} {y} {x + 6} {y - 6} {x + span} {y - 6} {x + span} {y + 6} {x + 6} {y + 6} {x} {y}"
            label = f"{name}~#0000FF~{x + 8}~{y - 8}~0~start~1~Times New Roman~8pt~{self.gid()}"
        self.flag_at.append((x, y, name))
        if direction == "L":
            self.flag_boxes.append((x - span, y - 18, x - 1, y + 6, name))
        else:
            self.flag_boxes.append((x + 1, y - 18, x + span, y + 6, name))
        self.shapes.append(
            f"F~part_netLabel_netPort~{x}~{y}~0~{self.gid()}~~0"
            f"^^{x}~{y}"
            f"^^{label}"
            f"^^PL~{pl}~#0000FF~1~0~transparent~{self.gid()}~0"
        )
        self.draw.append(("net", x, y, name, direction))

    def connect(self, xy, direction, net):
        x, y = xy
        # Ground symbols sit past the longest net flag so they do not cover the next pin.
        gnd_reach = 168
        if direction == "L":
            if net == "GND":
                end = (x - gnd_reach, y)
                self.wire([xy, end])
                self._flag_gnd(*end, "L")
            else:
                end = (x - STUB, y)
                self.wire([xy, end])
                self._flag_net(*end, net, "L")
        elif direction == "R":
            if net == "GND":
                end = (x + gnd_reach, y)
                self.wire([xy, end])
                self._flag_gnd(*end, "R")
            else:
                end = (x + STUB, y)
                self.wire([xy, end])
                self._flag_net(*end, net, "R")
        elif direction == "U":
            end = (x, y - STUB)
            self.wire([xy, end])
            self._flag_net(*end, net, "R")
        elif direction == "D":
            end = (x, y + 16)
            self.wire([xy, end])
            if net == "GND":
                self._flag_gnd(*end, "R")
            else:
                self._flag_net(*end, net, "R")
        else:
            raise ValueError(direction)

    def add_ic(self, ref, value, x, y, left, right, package, mpn, desc, lcsc="", pitch=10, body_w=None):
        n = max(len(left), len(right), 1)
        longest = max([len(nm) for _, nm in left + right] or [6])
        bw = body_w or max(150, min(longest, 24) * 7 + 36)
        bh = 16 + n * pitch
        pins = {}
        subs = []
        gid_body = self.gid()
        subs.append(f"R~{x}~{y}~~~{bw}~{bh}~#800000~1~0~none~{gid_body}~0~")
        self.draw.append(("r", x, y, bw, bh, "#800000"))
        self.touch(x, y)
        self.touch(x + bw, y + bh)
        self.body_boxes.append((x, y, x + bw, y + bh, ref))

        def one_pin(num, name, px, py, side):
            pins[str(num)] = (px, py, side)
            self.pins[f"{ref}.{num}"] = (px, py)
            self.touch(px, py)
            if side == "L":
                path = f"M {px} {py} h 16"
                name_s = f"1~{px + 20}~{py + 3}~0~{name}~start~Arial~8pt~#0000FF"
                num_s = f"1~{px - 3}~{py + 3}~0~{num}~end~Arial~7pt~#0000FF"
            else:
                path = f"M {px} {py} h -16"
                name_s = f"1~{px - 20}~{py + 3}~0~{name}~end~Arial~8pt~#0000FF"
                num_s = f"1~{px + 3}~{py + 3}~0~{num}~start~Arial~7pt~#0000FF"
            subs.append(
                f"P~show~0~{num}~{px}~{py}~0~{self.gid()}~0"
                f"^^{px}~{py}"
                f"^^{path}~#880000"
                f"^^{name_s}"
                f"^^{num_s}"
                f"^^0~{px}~{py}"
                f"^^0~M {px} {py} L {px} {py}"
            )
            self.draw.append(("pin", px, py, str(num), name, side))

        for i, (num, name) in enumerate(left):
            one_pin(num, name, x, y + 12 + i * pitch, "L")
        for i, (num, name) in enumerate(right):
            one_pin(num, name, x + bw, y + 12 + i * pitch, "R")

        subs.append(
            f"T~P~{x}~{y - 16}~0~#000080~Arial~10pt~~~~comment~{ref}~1~start~{self.gid()}~0"
        )
        subs.append(
            f"T~N~{x}~{y - 4}~0~#000080~Arial~9pt~~~~comment~{value}~1~start~{self.gid()}~0"
        )
        self.draw.append(("t", x, y - 16, ref, 10, "#000080"))
        self.draw.append(("t", x, y - 4, value, 9, "#000080"))
        cp = (
            f"package`{package}`pre`{ref}`Value`{value}`name`{value}`"
            f"Manufacturer Part`{mpn}`Supplier`LCSC`Supplier Part`{lcsc}`"
            f"Description`{desc}`"
        )
        sym = uuid.uuid4().hex
        header = f"LIB~{x}~{y}~{cp}~0~0~{self.gid()}~~{sym}~0~~yes~yes~~~"
        self.shapes.append(header + "#@$" + "#@$".join(subs))
        self.part(ref, value, package, mpn, desc, lcsc)
        return pins

    def add_two(self, ref, value, kind, x, y, package, mpn, desc, vertical=False, lcsc=""):
        if not vertical:
            p1, p2 = (x, y), (x + 70, y)
            side = ("L", "R")
            subs = [
                f"R~{x + 22}~{y - 8}~~~26~16~#A00000~1~0~none~{self.gid()}~0~",
                f"PL~{x} {y} {x + 22} {y}~#A00000~1~0~none~{self.gid()}~0",
                f"PL~{x + 48} {y} {x + 70} {y}~#A00000~1~0~none~{self.gid()}~0",
            ]
            if kind == "C":
                subs = [
                    f"PL~{x} {y} {x + 30} {y}~#8D2323~1~0~none~{self.gid()}~0",
                    f"PL~{x + 40} {y} {x + 70} {y}~#8D2323~1~0~none~{self.gid()}~0",
                    f"PL~{x + 30} {y - 10} {x + 30} {y + 10}~#8D2323~1~0~none~{self.gid()}~0",
                    f"PL~{x + 40} {y - 10} {x + 40} {y + 10}~#8D2323~1~0~none~{self.gid()}~0",
                ]
            if kind == "L":
                subs = [
                    f"PL~{x} {y} {x + 70} {y}~#A00000~1~0~none~{self.gid()}~0",
                    f"A~M {x + 16} {y} A 8 8 0 1 1 {x + 32} {y}~~#A00000~1~0~none~{self.gid()}~0",
                    f"A~M {x + 32} {y} A 8 8 0 1 1 {x + 48} {y}~~#A00000~1~0~none~{self.gid()}~0",
                ]
            if kind == "FB":
                subs.append(f"PL~{x + 28} {y - 6} {x + 42} {y + 6}~#A00000~1~0~none~{self.gid()}~0")
            label_x, label_y = x, y - 18
        else:
            p1, p2 = (x, y), (x, y + 70)
            side = ("U", "D")
            subs = [
                f"R~{x - 8}~{y + 22}~~~16~26~#A00000~1~0~none~{self.gid()}~0~",
                f"PL~{x} {y} {x} {y + 22}~#A00000~1~0~none~{self.gid()}~0",
                f"PL~{x} {y + 48} {x} {y + 70}~#A00000~1~0~none~{self.gid()}~0",
            ]
            if kind == "C":
                subs = [
                    f"PL~{x} {y} {x} {y + 30}~#8D2323~1~0~none~{self.gid()}~0",
                    f"PL~{x} {y + 40} {x} {y + 70}~#8D2323~1~0~none~{self.gid()}~0",
                    f"PL~{x - 10} {y + 30} {x + 10} {y + 30}~#8D2323~1~0~none~{self.gid()}~0",
                    f"PL~{x - 10} {y + 40} {x + 10} {y + 40}~#8D2323~1~0~none~{self.gid()}~0",
                ]
            label_x, label_y = x + 12, y + 24
        self.touch(*p1)
        self.touch(*p2)
        self.touch(label_x, label_y)
        if not vertical:
            self.body_boxes.append((x + 8, y - 16, x + 62, y + 16, ref))
        else:
            self.body_boxes.append((x - 16, y + 8, x + 16, y + 62, ref))
        pin_subs = []
        for num, (px, py), sd in ((1, p1, side[0]), (2, p2, side[1])):
            self.pins[f"{ref}.{num}"] = (px, py)
            if sd == "L":
                path = f"M {px} {py} h 8"
            elif sd == "R":
                path = f"M {px} {py} h -8"
            elif sd == "U":
                path = f"M {px} {py} v 8"
            else:
                path = f"M {px} {py} v -8"
            pin_subs.append(
                f"P~show~0~{num}~{px}~{py}~0~{self.gid()}~0"
                f"^^{px}~{py}"
                f"^^{path}~#880000"
                f"^^0~{px}~{py}~0~{num}~start~Arial~7pt~#0000FF"
                f"^^0~{px}~{py}~0~{num}~start~Arial~7pt~#0000FF"
                f"^^0~{px}~{py}"
                f"^^0~M {px} {py} L {px} {py}"
            )
        pin_subs.append(
            f"T~P~{label_x}~{label_y}~0~#000080~Arial~8pt~~~~comment~{ref}~1~start~{self.gid()}~0"
        )
        pin_subs.append(
            f"T~N~{label_x}~{label_y + 12}~0~#000080~Arial~8pt~~~~comment~{value}~1~start~{self.gid()}~0"
        )
        self.draw.append(("t", label_x, label_y, f"{ref} {value}", 8, "#000080"))
        cp = (
            f"package`{package}`pre`{ref}`Value`{value}`name`{value}`"
            f"Manufacturer Part`{mpn}`Description`{desc}`"
        )
        header = f"LIB~{x}~{y}~{cp}~0~0~{self.gid()}~~{uuid.uuid4().hex}~0~~yes~yes~~~"
        self.shapes.append(header + "#@$" + "#@$".join(subs + pin_subs))
        self.part(ref, value, package, mpn, desc, lcsc)
        return {"1": (*p1, side[0]), "2": (*p2, side[1])}

    def tie(self, ref_prefix, kind, value, package, mpn, desc, x, y, net_a, net_b, vertical=False):
        ref = self.p.ref(ref_prefix)
        pins = self.add_two(ref, value, kind, x, y, package, mpn, desc, vertical=vertical)
        self.connect((pins["1"][0], pins["1"][1]), pins["1"][2], net_a)
        self.connect((pins["2"][0], pins["2"][1]), pins["2"][2], net_b)
        self.pin_net[f"{ref}.1"] = net_a
        self.pin_net[f"{ref}.2"] = net_b
        return ref

    def to_json(self):
        pad = 40
        if self.minx > 10**8:
            self.minx, self.miny, self.maxx, self.maxy = 0, 0, 800, 600
        x0 = max(0, self.minx - pad)
        y0 = max(0, self.miny - pad)
        w = int(self.maxx - x0 + pad * 2)
        h = int(self.maxy - y0 + pad * 2)
        return {
            "docType": "1",
            "title": self.title,
            "description": "",
            "dataStr": {
                "head": {
                    "docType": "1",
                    "editorVersion": "6.5.51",
                    "newgId": True,
                    "c_para": {"Prefix Start": "1"},
                    "c_spiceCmd": "null",
                    "hasIdFlag": True,
                    "uuid": uuid.uuid4().hex,
                    "x": "0",
                    "y": "0",
                    "portOfADImportHack": "",
                    "importFlag": 0,
                    "transformList": "",
                },
                "canvas": f"CA~{max(w, 1200)}~{max(h, 800)}~#FFFFFF~yes~#CCCCCC~10~{max(w, 1200)}~{max(h, 800)}~line~10~pixel~5~0~0",
                "shape": self.shapes,
                "BBox": {
                    "x": int(x0),
                    "y": int(y0),
                    "width": w,
                    "height": h,
                },
                "colors": {},
            },
        }


class Project:
    def __init__(self):
        self._g = 1
        self._refs = defaultdict(int)
        self.parts = []
        self.sheets = []

    def gid(self):
        g = f"gge{self._g}"
        self._g += 1
        return g

    def ref(self, prefix):
        self._refs[prefix] += 1
        return f"{prefix}{self._refs[prefix]}"

    def sheet(self, title):
        s = Sch(title, self)
        self.sheets.append(s)
        return s


def banner(s, lines):
    s.note(40, 36, lines[0], 16, "#1a1a1a")
    y = 58
    for line in lines[1:]:
        s.note(40, y, line, 10, "#444444")
        y += 14
    return y + 10


def decouple(s, x, y, rail, n100n, bulk, tag):
    s.note(x, y, tag, 10, "#666666")
    yy = y + 18
    for i in range(n100n):
        s.tie("C", "C", "100nF", "0402", "100nF 50V X7R", f"{rail} decouple", x, yy, rail, "GND")
        yy += 28
    if bulk:
        s.tie("C", "C", bulk, "0805", bulk, f"{rail} bulk", x, yy, rail, "GND")
        yy += 36
    return yy


def sheet_power_in(p):
    s = p.sheet("01_Power_Input")
    y = banner(
        s,
        [
            "8x 2.5G PoE+ switch  +  4x 10G SFP+     reference schematic",
            "Copper: RTL8221B-VB-CG (HiSGMII) x8.  PoE: TPS23881, 2-pair 802.3at, 30 W/port, 240 W budget.",
            "Uplinks: SFP+ cages on switch SerDes (10GBASE-R).  Switch SoC: RTL9313-class functional symbol.",
            "External supply: 54 VDC, 6 A minimum (about 320 W).  Logic ground = 54 V return (non-isolated).",
            "NOT a fabrication file. Replace U_SW with the Realtek BGA symbol before any PCB.",
        ],
    )
    s.note(40, y + 8, "54 V input, reverse polarity, fuse, TVS", 12, "#111111")
    s.note(
        40,
        y + 28,
        "P-MOS: source = fused input, drain = VIN_54V, gate pulled to GND. 12 V zener from gate to source. IRF9540N pins are 1=G, 2=D, 3=S.",
        9,
    )
    base = y + 90
    j = s.add_ic(
        p.ref("J"),
        "54V_IN",
        60,
        base,
        [],
        [(1, "VIN"), (2, "GND")],
        "TERMINAL-2",
        "2-pin 54V terminal or barrel",
        "54 VDC power input",
        pitch=48,
        body_w=140,
    )
    s.connect((j["1"][0], j["1"][1]), "R", "VIN_RAW")
    s.connect((j["2"][0], j["2"][1]), "R", "GND")
    s.pin_net[f"{s.p.parts[-1]['ref']}.1"] = "VIN_RAW"
    s.pin_net[f"{s.p.parts[-1]['ref']}.2"] = "GND"
    # Align the fuse with the VIN pin (body top + 12).
    s.tie("F", "F", "8A", "fuse-2410", "8 A slow", "Input fuse before the reverse-protection FET", 480, base + 12, "VIN_RAW", "VIN_FUSED")
    q = s.add_ic(
        p.ref("Q"),
        "IRF9540N",
        920,
        base - 8,
        [(1, "G")],
        [(2, "D"), (3, "S")],
        "TO-220",
        "IRF9540NPBF",
        "100 V P-MOS reverse polarity. Dissipation is high at 6 A. Swap a part under 20 mohm before build.",
        pitch=40,
        body_w=150,
    )
    qref = s.p.parts[-1]["ref"]
    for num, net, side in (("1", "QGATE", "L"), ("2", "VIN_54V", "R"), ("3", "VIN_FUSED", "R")):
        s.connect((q[num][0], q[num][1]), side, net)
        s.pin_net[f"{qref}.{num}"] = net
    col = 1560
    row = base
    s.tie("R", "R", "100k", "0805", "100k", "Gate pull-down", col, row, "QGATE", "GND")
    s.tie("D", "D", "BZT52C12", "SOD-123", "BZT52C12", "Vgs clamp. Pin 1 anode = QGATE, pin 2 cathode = VIN_FUSED.", col, row + 80, "QGATE", "VIN_FUSED")
    s.tie("D", "D", "SMBJ58A", "SMB", "SMBJ58A", "Input TVS. Pin 1 anode = GND, pin 2 cathode = VIN_54V. Clamp can exceed the TPS23881 70 V abs max.", col, row + 160, "GND", "VIN_54V")
    s.tie("C", "C", "100uF/100V", "electro-10mm", "100uF 100V", "Input bulk", col, row + 240, "VIN_54V", "GND")
    s.tie("C", "C", "4.7uF/100V", "1210", "4.7uF 100V X7R", "Input ceramic", col, row + 320, "VIN_54V", "GND")
    s.tie("C", "C", "4.7uF/100V", "1210", "4.7uF 100V X7R", "Input ceramic", col, row + 400, "VIN_54V", "GND")
    col2 = 2100
    s.tie("R", "R", "1M", "1206", "1M", "Chassis bleed. The only DC bond from GND to CHASSIS.", col2, row, "GND", "CHASSIS")
    s.tie("C", "C", "4.7nF/2kV", "1206", "4.7nF 2kV", "Chassis Y-cap, one place only", col2, row + 80, "GND", "CHASSIS")
    s.note(col2, row + 160, "CHASSIS is the RJ45 shields and the mounting holes.", 10)
    y2 = row + 500
    s.note(40, y2, "Power tree (sheets 02 and 03)", 12)
    for i, line in enumerate(
        [
            "VIN_54V -> TPS54560B -> 5.0 V. PHY core bucks, DDR buck, SoC core buck. RT = 243k (400 kHz). FB = 53.6k / 10.2k.",
            "VIN_54V -> TPS54560B -> 3.3 V. PHY I/O, SFP, flash, SoC I/O. FB = 31.6k / 10.0k.",
            "VIN_54V -> TPS54560B -> 12 V fan. FB = 140k / 10.0k. Inductor 15 uH. COMP is copied from the 5 V example.",
            "5 V -> TPS54302 x8, one per RTL8221B, 0.95 V, enabled by that PHY POW_EXT_SWR pin.",
            "5 V -> TPS54302 DDR 1.5 V, then TPS51200 for VTT. 5 V -> TPS54302 SoC core placeholder (confirm the Realtek voltage).",
            "UVLO on the 54 V bucks starts near 48 V and stops near 44 V.",
        ]
    ):
        s.note(40, y2 + 24 + i * 16, line, 10)
    return s


def place_tps54560(s, p, ox, oy, name, vout, r_top, r_bot, l_value, cout):
    s.note(ox, oy, name, 12, "#111")
    u = s.add_ic(
        p.ref("U"),
        "TPS54560B",
        ox + 300,
        oy + 28,
        [(2, "VIN"), (3, "EN"), (4, "RT"), (5, "FB"), (6, "COMP"), (7, "GND"), (9, "EP")],
        [(1, "BOOT"), (8, "SW")],
        "SOIC-8-EP",
        "TPS54560BDDA",
        "60 V 5 A buck. 400 kHz values from SLVSF00, except FB and the 12 V inductor.",
        pitch=32,
        body_w=160,
    )
    uref = s.p.parts[-1]["ref"]
    tag = vout.replace("V", "")
    sw, boot, fb, comp, en = f"SW_{tag}", f"BOOT_{tag}", f"FB_{tag}", f"COMP_{tag}", f"EN_{tag}"
    mid = f"CMPMID_{tag}"
    nets = {
        "2": "VIN_54V",
        "3": en,
        "4": f"RT_{tag}",
        "5": fb,
        "6": comp,
        "7": "GND",
        "9": "GND",
        "1": boot,
        "8": sw,
    }
    for num, net in nets.items():
        x, y, side = u[num]
        s.connect((x, y), side, net)
        s.pin_net[f"{uref}.{num}"] = net
    c1 = ox + 820
    c2 = ox + 1400
    y0 = oy + 40
    dy = 72
    s.tie("R", "R", "243k", "0402", "243k 1%", "RT sets 400 kHz. R(kohm) = 101756 / fsw^1.008", c1, y0, f"RT_{tag}", "GND")
    s.tie("R", "R", "1.18M", "0402", "1.18M 1%", "UVLO top, start about 48 V", c1, y0 + dy, "VIN_54V", en)
    s.tie("R", "R", "29.4k", "0402", "29.4k 1%", "UVLO bottom, stop about 44 V", c1, y0 + 2 * dy, en, "GND")
    s.tie("D", "D", "BZT52C6V2", "SOD-123", "BZT52C6V2", "EN clamp. Pin 1 anode to GND, pin 2 cathode to EN.", c1, y0 + 3 * dy, "GND", en)
    s.tie("R", "R", "243k", "0402", "243k", "COMP series R", c1, y0 + 4 * dy, comp, mid)
    s.tie("C", "C", "4700pF", "0402", "4700pF", "COMP series C", c1, y0 + 5 * dy, mid, "GND")
    s.tie("C", "C", "47pF", "0402", "47pF", "COMP high-frequency C", c1, y0 + 6 * dy, comp, "GND")
    s.tie("C", "C", "100nF", "0402", "100nF 16V", "BOOT to SW", c2, y0, boot, sw)
    s.tie("L", "L", l_value, "ind-7x7", l_value, "Output inductor", c2, y0 + dy, sw, vout)
    s.tie("D", "D", "SS510", "SMC", "SS510", "100 V 5 A catch diode. Pin 1 anode = GND, pin 2 cathode = SW.", c2, y0 + 2 * dy, "GND", sw)
    s.tie("R", "R", r_top, "0402", f"{r_top} 1%", "FB top", c2, y0 + 3 * dy, vout, fb)
    s.tie("R", "R", r_bot, "0402", f"{r_bot} 1%", "FB bottom", c2, y0 + 4 * dy, fb, "GND")
    s.tie("C", "C", "2.2uF/100V", "1210", "2.2uF 100V", "VIN ceramic", c2, y0 + 5 * dy, "VIN_54V", "GND")
    s.tie("C", "C", "2.2uF/100V", "1210", "2.2uF 100V", "VIN ceramic", c2, y0 + 6 * dy, "VIN_54V", "GND")
    s.tie("C", "C", cout, "0805", cout, "VOUT ceramic", c2, y0 + 7 * dy, vout, "GND")
    s.note(ox, oy + 560, "Retune COMP in WEBENCH for 3.3 V and 12 V. The 5.0 V network matches Fig. 32 except the catch diode is 100 V.", 9)


def sheet_rails(p):
    s = p.sheet("02_Rails_5V_3V3_12V")
    banner(
        s,
        [
            "System bucks from VIN_54V. All three use the same 400 kHz and UVLO network.",
            "5.00 V = 0.8*(1+53.6/10.2).   3.33 V = 0.8*(1+31.6/10.0).   12.0 V = 0.8*(1+140/10).",
        ],
    )
    place_tps54560(s, p, 40, 100, "5.0 V for the PHY bucks, the DDR buck, and the SoC core buck", "V5", "53.6k", "10.2k", "7.2uH", "47uF/16V")
    place_tps54560(s, p, 40, 720, "3.3 V PHY I/O, SFP cages, flash, SoC I/O", "V3V3", "31.6k", "10.0k", "7.2uH", "47uF/16V")
    place_tps54560(s, p, 40, 1340, "12 V fan. Ripple at 60 V in is about 1.6 A with 15 uH.", "V12", "140k", "10.0k", "15uH", "47uF/25V")
    s.tie("C", "C", "47uF/16V", "0805", "47uF 16V", "extra 5 V bulk", 40, 2000, "V5", "GND")
    s.tie("C", "C", "47uF/16V", "0805", "47uF 16V", "extra 3.3 V bulk", 520, 2000, "V3V3", "GND")
    return s


def place_tps54302(s, p, ox, oy, title, vout, r_top, r_bot, enable_net, enable_note, foot):
    s.note(ox, oy, title, 11, "#111")
    u = s.add_ic(
        p.ref("U"),
        "TPS54302",
        ox + 260,
        oy + 28,
        [(1, "GND"), (2, "SW"), (3, "VIN")],
        [(6, "BOOT"), (5, "EN"), (4, "FB")],
        "SOT-23-6",
        "TPS54302DDCR",
        "3 A synchronous buck, 400 kHz, Vref 0.596 V. Pins: 1 GND, 2 SW, 3 VIN, 4 FB, 5 EN, 6 BOOT.",
        pitch=32,
        body_w=140,
    )
    uref = s.p.parts[-1]["ref"]
    sw, boot, fb = f"SW_{vout}", f"BOOT_{vout}", f"FB_{vout}"
    nets = {"1": "GND", "2": sw, "3": "V5", "4": fb, "5": enable_net, "6": boot}
    for num, net in nets.items():
        x, y, side = u[num]
        s.connect((x, y), side, net)
        s.pin_net[f"{uref}.{num}"] = net
    col = ox + 820
    y0 = oy + 40
    dy = 72
    s.tie("L", "L", "4.7uH", "ind-4x4", "4.7uH", "TPS54302 inductor", col, y0, sw, vout)
    s.tie("C", "C", "100nF", "0402", "100nF", "BOOT cap", col, y0 + dy, boot, sw)
    s.tie("R", "R", r_top, "0402", f"{r_top} 1%", "FB top", col, y0 + 2 * dy, vout, fb)
    s.tie("R", "R", r_bot, "0402", f"{r_bot} 1%", "FB bottom", col, y0 + 3 * dy, fb, "GND")
    s.tie("C", "C", "10uF", "0805", "10uF 16V", "VIN cap", col, y0 + 4 * dy, "V5", "GND")
    s.tie("C", "C", "22uF", "0805", "22uF 6.3V", "VOUT cap", col, y0 + 5 * dy, vout, "GND")
    if enable_net != "V5":
        s.tie("R", "R", "100k", "0402", "100k", enable_note, col, y0 + 6 * dy, enable_net, "GND")
    s.note(ox, oy + 560, foot, 9)


def sheet_core(p):
    s = p.sheet("03_PHY_0V95_and_DDR")
    banner(
        s,
        [
            "Each RTL8221B gets its own 0.95 V buck. POW_EXT_SWR (pin 46) enables that buck after 3.3 V is up.",
            "Datasheet: 0.95 V typical 364 mA, max 650 mA. One TPS54302 per PHY stays inside the 3 A limit.",
            "DDR3 1.5 V is a separate TPS54302. VTT is TPS51200 with functional pins. Confirm the DSK-10 numbers in SLUS804.",
            "V095_SOC is a ninth buck. 6.04k/10.2k targets 0.95 V. Change the divider if the Realtek core voltage differs.",
        ],
    )
    foot_phy = "6.04k / 10.2k -> 0.949 V. RTL8221B 0.95 V range is 0.92 V to 0.98 V."
    for i in range(8):
        n = i + 1
        col = i % 2
        row = i // 2
        place_tps54302(
            s,
            p,
            40 + col * 1400,
            130 + row * 640,
            f"PHY{n} 0.95 V    EN = EN_095_P{n} from POW_EXT_SWR",
            f"V095_P{n}",
            "6.04k",
            "10.2k",
            f"EN_095_P{n}",
            "EN pulldown until POW_EXT_SWR goes high",
            foot_phy,
        )
    yb = 130 + 4 * 640
    s.note(40, yb, "DDR3 rail, termination, and the switch-core placeholder", 12)
    place_tps54302(
        s, p, 40, yb + 24,
        "DDR VDD/VDDQ 1.50 V. EN tied to V5. 15.4k/10.2k -> 1.496 V.",
        "V1V5", "15.4k", "10.2k", "V5", "",
        "Synchronous buck, no catch diode.",
    )
    place_tps54302(
        s, p, 1440, yb + 24,
        "SoC core placeholder. Confirm the voltage in the Realtek hardware design guide.",
        "V095_SOC", "6.04k", "10.2k", "V5", "",
        "EN is tied to V5. Resequence this enable if the HDG requires it. Resize FB for the real core voltage.",
    )
    vx = 40
    vy = yb + 680
    s.note(vx, vy, "DDR VREF and TPS51200. Pin numbers on U_TPS51200 are functional, not the DSK-10 ball map.", 11)
    s.tie("R", "R", "1.00k 0.1%", "0402", "1.00k 0.1%", "VREF divider top", vx, vy + 36, "V1V5", "VREF")
    s.tie("R", "R", "1.00k 0.1%", "0402", "1.00k 0.1%", "VREF divider bottom", vx + 480, vy + 36, "VREF", "GND")
    s.tie("C", "C", "100nF", "0402", "100nF", "VREF cap", vx + 960, vy + 36, "VREF", "GND")
    u = s.add_ic(
        p.ref("U"),
        "TPS51200",
        vx + 1500,
        vy + 20,
        [(1, "REFIN"), (2, "VIN"), (3, "VLDOIN"), (4, "EN")],
        [(5, "VTT"), (6, "VTTREF"), (7, "GND"), (8, "PGOOD")],
        "DSK-10 functional",
        "TPS51200DSKR",
        "DDR termination. Pin numbers here are functional. Map them to the TI DSK-10 footprint before layout.",
        pitch=32,
        body_w=160,
    )
    uref = s.p.parts[-1]["ref"]
    nets = {"1": "VREF", "2": "V3V3", "3": "V1V5", "4": "V3V3", "5": "VTT", "6": "VTTREF", "7": "GND", "8": "PG_VTT"}
    for num, net in nets.items():
        x, y, side = u[num]
        s.connect((x, y), side, net)
        s.pin_net[f"{uref}.{num}"] = net
    s.tie("C", "C", "10uF", "0805", "10uF", "VTT bulk", vx + 2100, vy + 36, "VTT", "GND")
    s.tie("C", "C", "100nF", "0402", "100nF", "VTTREF cap", vx + 2100, vy + 110, "VTTREF", "GND")
    s.note(vx, vy + 200, "MT41K256M16 power pins are on sheet 10. Address and DQ balls follow the Realtek DDR3 pin table.", 10)
    return s


TPS23881_LEFT = [
    (1, "GAT1"), (2, "SEN1"), (3, "DRAIN1"), (4, "KSENSA"), (5, "DRAIN2"), (6, "SEN2"),
    (7, "GAT2"), (8, "GAT3"), (9, "SEN3"), (10, "DRAIN3"), (11, "KSENSB"), (12, "DRAIN4"),
    (13, "SEN4"), (14, "GAT4"), (15, "NC15"), (16, "NC16"), (17, "VPWR"), (18, "NC18"),
    (19, "NC19"), (20, "TEST0"), (21, "AGND"), (22, "NC22"), (23, "TEST1"), (24, "TEST2"),
    (25, "TEST3"), (26, "TEST4"), (27, "NC27"), (28, "NC28"),
]
TPS23881_RIGHT = [
    (29, "GAT5"), (30, "SEN5"), (31, "DRAIN5"), (32, "KSENSC"), (33, "DRAIN6"), (34, "SEN6"),
    (35, "GAT6"), (36, "GAT7"), (37, "SEN7"), (38, "DRAIN7"), (39, "KSENSD"), (40, "DRAIN8"),
    (41, "SEN8"), (42, "GAT8"), (43, "VDD"), (44, "RESET"), (45, "INT"), (46, "DGND"),
    (47, "TEST5"), (48, "A1"), (49, "A2"), (50, "A3"), (51, "A4"), (52, "NC52"),
    (53, "SCL"), (54, "SDAI"), (55, "SDAO"), (56, "OSS"), (57, "EP"),
]


def sheet_pse(p):
    s = p.sheet("04_PSE_TPS23881")
    banner(
        s,
        [
            "TPS23881RTQR, 8 channels, one channel per RJ45 (2-pair Alt-A, pairs 1-2 positive and 3-6 negative).",
            "RSENSE is 0.200 ohm (not 0.255). SDAI tied to SDAO. A4:A1 strapped low -> 7-bit address 0x20 in 16-bit config B.",
            "Leave every NC and TEST pin open. AGND, DGND, and the exposed pad all go to GND.",
            "Kelvin: route KSENSA to the GND pads of RS1 and RS2 only. Same idea for KSENSB/C/D. Do not use a random ground via.",
        ],
    )
    u = s.add_ic(
        p.ref("U"),
        "TPS23881",
        480,
        120,
        TPS23881_LEFT,
        TPS23881_RIGHT,
        "VQFN-56",
        "TPS23881RTQR",
        "8-channel 802.3bt PSE controller used here as 8x 2-pair 30 W.",
        pitch=30,
        body_w=220,
    )
    uref = s.p.parts[-1]["ref"]
    power = {
        "17": "VIN_54V",
        "43": "V3V3",
        "21": "GND",
        "46": "GND",
        "57": "GND",
        "44": "PSE_RST_N",
        "45": "PSE_INT_N",
        "53": "I2C_SCL",
        "54": "I2C_SDA",
        "55": "I2C_SDA",
        "56": "PSE_OSS",
        "48": "GND",
        "49": "GND",
        "50": "GND",
        "51": "GND",
        "4": "KS_A",
        "11": "KS_B",
        "32": "KS_C",
        "39": "KS_D",
    }
    for ch, pins in {
        1: ("1", "2", "3"),
        2: ("7", "6", "5"),
        3: ("8", "9", "10"),
        4: ("14", "13", "12"),
        5: ("29", "30", "31"),
        6: ("35", "34", "33"),
        7: ("36", "37", "38"),
        8: ("42", "41", "40"),
    }.items():
        gat, sen, drain = pins
        power[gat] = f"GAT_{ch}"
        power[sen] = f"SEN_{ch}"
        power[drain] = f"VPORT_N_{ch}"
    for num, (x, y, side) in u.items():
        net = power.get(num)
        if net is None:
            continue
        s.connect((x, y), side, net)
        s.pin_net[f"{uref}.{num}"] = net
    col = 1280
    row = 160
    dy = 72
    s.tie("C", "C", "100nF/100V", "0805", "100nF 100V", "VPWR bypass at pin 17", col, row, "VIN_54V", "GND")
    s.tie("C", "C", "100nF", "0402", "100nF", "VDD bypass at pin 43", col, row + dy, "V3V3", "GND")
    s.tie("C", "C", "10uF", "0805", "10uF 10V", "VDD bulk", col, row + 2 * dy, "V3V3", "GND")
    s.tie("R", "R", "10k", "0402", "10k", "PSE reset pull-up", col, row + 3 * dy, "V3V3", "PSE_RST_N")
    s.tie("R", "R", "10k", "0402", "10k", "INT pull-up, open drain", col, row + 4 * dy, "V3V3", "PSE_INT_N")
    s.tie("R", "R", "10k", "0402", "10k", "OSS pulldown. The SoC may drive this high to shut every port off.", col, row + 5 * dy, "PSE_OSS", "GND")
    s.tie("R", "R", "0", "0402", "0 ohm", "Kelvin net-tie for channels 1 and 2. Place it on the GND pads of those sense resistors.", col + 480, row, "KS_A", "GND")
    s.tie("R", "R", "0", "0402", "0 ohm", "Kelvin net-tie for channels 3 and 4.", col + 480, row + dy, "KS_B", "GND")
    s.tie("R", "R", "0", "0402", "0 ohm", "Kelvin net-tie for channels 5 and 6.", col + 480, row + 2 * dy, "KS_C", "GND")
    s.tie("R", "R", "0", "0402", "0 ohm", "Kelvin net-tie for channels 7 and 8.", col + 480, row + 3 * dy, "KS_D", "GND")
    s.note(col, row + 7 * dy, "Port FETs, 0.200 ohm sense resistors, fuses, and port TVS are on sheets 05 and 06.", 10)
    s.note(col, row + 7 * dy + 18, "The gate pin goes straight to the MOSFET gate. No gate pulldown. Leakage must stay under 250 nA.", 10)
    s.note(col, row + 7 * dy + 36, "KS_A touches the GND pads of ports 1 and 2 only. Same pattern for KS_B, KS_C, and KS_D.", 10)
    return s


def place_poe_port(s, p, n, ox, oy):
    ks = {1: "KS_A", 2: "KS_A", 3: "KS_B", 4: "KS_B", 5: "KS_C", 6: "KS_C", 7: "KS_D", 8: "KS_D"}[n]
    s.note(ox, oy, f"PoE port {n}   Alt-A   VPORT_P_{n} = pair 1-2 center tap    VPORT_N_{n} = pair 3-6 center tap    sense return {ks}", 11)
    row = oy + 40
    s.tie("F", "F", "1.5A", "fuse-1206", "1.5 A", f"Port {n} positive fuse", ox + 40, row, "VIN_54V", f"VPORT_P_{n}")
    q = s.add_ic(
        p.ref("Q"),
        "IRF540N",
        ox + 480,
        oy + 16,
        [(1, "G")],
        [(2, "D"), (3, "S")],
        "TO-220",
        "IRF540N",
        "100 V N-MOS low-side PoE switch. Pins 1=G, 2=D, 3=S. An SMD 100 V FET can replace it.",
        pitch=36,
        body_w=130,
    )
    qref = s.p.parts[-1]["ref"]
    mapping = {"1": (f"GAT_{n}", "L"), "2": (f"VPORT_N_{n}", "R"), "3": (f"SEN_{n}", "R")}
    for num, (net, side) in mapping.items():
        s.connect((q[num][0], q[num][1]), side, net)
        s.pin_net[f"{qref}.{num}"] = net
    s.tie("R", "R", "0.200", "2512", "0.200 1% 1W", f"Port {n} RSENSE. TPS23881 value is 0.200 ohm, not 0.255.", ox + 1040, row, f"SEN_{n}", ks)
    s.tie("D", "D", "SMBJ58A", "SMB", "SMBJ58A", f"Port {n} TVS. Pin 1 anode = VPORT_N, pin 2 cathode = VPORT_P.", ox + 1560, row, f"VPORT_N_{n}", f"VPORT_P_{n}")
    s.tie("C", "C", "10nF/100V", "0805", "10nF 100V", f"Port {n} EMI cap. Keep it small so detection still works.", ox + 2100, row, f"VPORT_P_{n}", "GND")
    s.note(ox, oy + 120, "FET drain = DRAIN pin = pair B center tap. Sense bottom is the Kelvin net, tied to GND only by the 0 ohm on sheet 04.", 9)


def sheet_poe_ports(p, title, ports):
    s = p.sheet(title)
    banner(
        s,
        [
            title.replace("_", " "),
            "Low-side FET per channel. The 0.200 ohm sense resistor returns to KS_A/B/C/D, not to a random ground flag.",
            "TVS pin 1 is the anode. The 10 nF cap is from VPORT_P to GND only.",
        ],
    )
    for i, n in enumerate(ports):
        place_poe_port(s, p, n, 40, 120 + i * 200)
    return s


PHY_LEFT = [
    (1, "PHYRSTB"), (2, "MDC"), (3, "MDIO"), (4, "DVDD09"), (5, "DVDD3318"),
    (6, "CLKOUT"), (7, "AVDD33"), (8, "AVDD33_XTAL"), (9, "CKXTAL2"), (10, "CKXTAL1"),
    (11, "AVDD09"), (12, "RSET"), (13, "MDIP0"), (14, "MDIN0"), (15, "AVDD33"),
    (16, "AVDD09"), (17, "MDIP1"), (18, "MDIN1"), (19, "AVDD33"), (20, "MDIP2"),
    (21, "MDIN2"), (22, "AVDD09"), (23, "MDIP3"), (24, "MDIN3"),
]
PHY_RIGHT = [
    (25, "SPISO"), (26, "SPICSB"), (27, "GPIO27"), (28, "DVDD09"), (29, "CFG_OPT0"),
    (30, "CFG_OPT1"), (31, "DVDD33"), (32, "GPIO32"), (33, "LED0_AD0"), (34, "LED1_AD1"),
    (35, "LED2_AD2"), (36, "EVDD09"), (37, "HSON"), (38, "HSOP"), (39, "GND"),
    (40, "HSIP"), (41, "HSIN"), (42, "DVDD33"), (43, "DVDD09"), (44, "NC44"),
    (45, "NC45"), (46, "POW_EXT_SWR"), (47, "NC47"), (48, "INTB"), (49, "EP"),
]


def place_copper(s, p, n, ox, oy):
    s.rect(ox, oy, 2860, 1340, "#e8e8e8")
    addr = n - 1
    s.note(ox + 8, oy + 18, f"Port {n}   RTL8221B PHY address {addr}   HiSGMII / 2500BASE-X toward the switch", 12, "#111")
    v09 = f"V095_P{n}"
    phy = s.add_ic(
        p.ref("U"),
        "RTL8221B",
        ox + 980,
        oy + 48,
        PHY_LEFT,
        PHY_RIGHT,
        "QFN-48-EP",
        "RTL8221B-VB-CG",
        "2.5GBASE-T PHY, QFN-48. LCSC C5155988. SerDes mode is set by the switch over MDIO.",
        "C5155988",
        pitch=30,
        body_w=260,
    )
    uref = s.p.parts[-1]["ref"]
    nets = {
        "1": "PHY_RST_N",
        "2": "MDC",
        "3": "MDIO",
        "4": v09,
        "5": "V3V3",
        "7": "V3V3",
        "8": "V3V3",
        "9": f"XTAL2_P{n}",
        "10": f"XTAL1_P{n}",
        "11": v09,
        "12": f"RSET_P{n}",
        "13": f"P{n}_MDIA_P",
        "14": f"P{n}_MDIA_N",
        "15": "V3V3",
        "16": v09,
        "17": f"P{n}_MDIB_P",
        "18": f"P{n}_MDIB_N",
        "19": "V3V3",
        "20": f"P{n}_MDIC_P",
        "21": f"P{n}_MDIC_N",
        "22": v09,
        "23": f"P{n}_MDID_P",
        "24": f"P{n}_MDID_N",
        "27": f"GPIO27_P{n}",
        "28": v09,
        "29": f"CFG0_P{n}",
        "30": f"CFG1_P{n}",
        "31": "V3V3",
        "33": f"LED0_P{n}",
        "34": f"LED1_P{n}",
        "35": f"LED2_P{n}",
        "36": v09,
        "37": f"P{n}_HSON",
        "38": f"P{n}_HSOP",
        "39": "GND",
        "40": f"P{n}_FROM_SW_P",
        "41": f"P{n}_FROM_SW_N",
        "42": "V3V3",
        "43": v09,
        "46": f"EN_095_P{n}",
        "48": "PHY_INT_N",
        "49": "GND",
    }
    for num, (x, y, side) in phy.items():
        net = nets.get(num)
        if not net:
            continue
        s.connect((x, y), side, net)
        s.pin_net[f"{uref}.{num}"] = net
    y0 = oy + 56
    dy = 72
    s.tie("R", "R", "2.49k", "0402", "2.49k 1%", "RSET to GND, datasheet pin 12", ox + 40, y0, f"RSET_P{n}", "GND")
    s.tie("Y", "Y", "25MHz", "3225", "25 MHz parallel", "Crystal. Datasheet table 147: 27 pF from each pin to GND.", ox + 40, y0 + dy, f"XTAL1_P{n}", f"XTAL2_P{n}")
    s.tie("C", "C", "27pF", "0402", "27pF C0G", "XTAL1 shunt", ox + 40, y0 + 2 * dy, f"XTAL1_P{n}", "GND")
    s.tie("C", "C", "27pF", "0402", "27pF C0G", "XTAL2 shunt", ox + 40, y0 + 3 * dy, f"XTAL2_P{n}", "GND")
    s.tie("R", "R", "4.7k", "0402", "4.7k", "CFG_OPT0 pulldown = clock out off", ox + 40, y0 + 4 * dy, f"CFG0_P{n}", "GND")
    s.tie("R", "R", "4.7k", "0402", "4.7k", "CFG_OPT1 pulldown = normal MDI order", ox + 40, y0 + 5 * dy, f"CFG1_P{n}", "GND")
    s.tie("R", "R", "4.7k", "0402", "4.7k", "GPIO15882 pulldown required by the datasheet", ox + 40, y0 + 6 * dy, f"GPIO27_P{n}", "GND")
    s.tie("C", "C", "100nF", "0402", "100nF", "HSOP AC couple, place next to the PHY pin", ox + 40, y0 + 7 * dy, f"P{n}_HSOP", f"P{n}_TO_SW_P")
    s.tie("C", "C", "100nF", "0402", "100nF", "HSON AC couple, place next to the PHY pin", ox + 40, y0 + 8 * dy, f"P{n}_HSON", f"P{n}_TO_SW_N")
    bits = [(addr & 1), (addr >> 1) & 1, (addr >> 2) & 1]
    for b, bit in enumerate(bits):
        net = f"LED{b}_P{n}"
        yy = y0 + b * 3 * dy
        if bit:
            s.tie("R", "R", "4.7k", "0402", "4.7k", f"PHYAD{b}=1 pull-up to the LED pin", ox + 500, yy, "V3V3", net)
            s.tie("R", "R", "1k", "0402", "1k", f"LED{b} current limit from 3.3 V", ox + 500, yy + dy, "V3V3", f"LED{b}A_P{n}")
            s.tie("D", "LED", "LED", "0603", "LED", f"Port {n} LED{b}. Pin 1 anode, pin 2 cathode at the PHY pin (active low).", ox + 500, yy + 2 * dy, f"LED{b}A_P{n}", net)
        else:
            s.tie("R", "R", "4.7k", "0402", "4.7k", f"PHYAD{b}=0 pull-down", ox + 500, yy, net, "GND")
            s.tie("R", "R", "1k", "0402", "1k", f"LED{b} series from the PHY pin", ox + 500, yy + dy, net, f"LED{b}A_P{n}")
            s.tie("D", "LED", "LED", "0603", "LED", f"Port {n} LED{b}. Pin 1 anode after the 1k, pin 2 cathode to GND.", ox + 500, yy + 2 * dy, f"LED{b}A_P{n}", "GND")
    s.note(ox + 40, y0 + 10 * dy, "Address strap sets the LED wiring. Flip a lamp in register 7.19 if the polarity is inverted.", 9)

    mag = s.add_ic(
        p.ref("T"),
        "2.5G_POE_MAG",
        ox + 1680,
        oy + 48,
        [
            (1, "PA_P"), (2, "PA_N"), (3, "PA_CT"), (4, "PB_P"), (5, "PB_N"), (6, "PB_CT"),
            (7, "PC_P"), (8, "PC_N"), (9, "PC_CT"), (10, "PD_P"), (11, "PD_N"), (12, "PD_CT"),
        ],
        [
            (13, "LA_P"), (14, "LA_N"), (15, "LA_CT"), (16, "LB_P"), (17, "LB_N"), (18, "LB_CT"),
            (19, "LC_P"), (20, "LC_N"), (21, "LC_CT"), (22, "LD_P"), (23, "LD_N"), (24, "LD_CT"),
            (25, "SHIELD"),
        ],
        "24-pin discrete",
        "2.5GBASE-T PoE magnetics 1:1",
        "Logical pinout. Remap to the chosen Pulse/Wurth/Link-PP 2.5G PoE transformer before PCB.",
        pitch=30,
        body_w=200,
    )
    mref = s.p.parts[-1]["ref"]
    mag_nets = {
        "1": f"P{n}_MDIA_P", "2": f"P{n}_MDIA_N", "3": f"P{n}_CTA",
        "4": f"P{n}_MDIB_P", "5": f"P{n}_MDIB_N", "6": f"P{n}_CTB",
        "7": f"P{n}_MDIC_P", "8": f"P{n}_MDIC_N", "9": f"P{n}_CTC",
        "10": f"P{n}_MDID_P", "11": f"P{n}_MDID_N", "12": f"P{n}_CTD",
        "13": f"P{n}_LA_P", "14": f"P{n}_LA_N", "15": f"VPORT_P_{n}",
        "16": f"P{n}_LB_P", "17": f"P{n}_LB_N", "18": f"VPORT_N_{n}",
        "19": f"P{n}_LC_P", "20": f"P{n}_LC_N", "21": f"P{n}_LCT_C",
        "22": f"P{n}_LD_P", "23": f"P{n}_LD_N", "24": f"P{n}_LCT_D",
        "25": "CHASSIS",
    }
    for num, (x, y, side) in mag.items():
        net = mag_nets[num]
        s.connect((x, y), side, net)
        s.pin_net[f"{mref}.{num}"] = net
    ct_y = oy + 520
    for i, ct in enumerate("ABCD"):
        s.tie("C", "C", "100nF", "0402", "100nF 50V", f"PHY-side center tap {ct} to GND", ox + 1680, ct_y + i * 72, f"P{n}_CT{ct}", "GND")
    bs = oy + 840
    s.tie("R", "R", "75", "0402", "75 1%", "Bob Smith pair A. Own capacitor so 54 V has no DC path.", ox + 1680, bs, f"VPORT_P_{n}", f"BS_A_P{n}")
    s.tie("C", "C", "1nF/2kV", "1206", "1nF 2kV", "Bob Smith pair A to chassis", ox + 2160, bs, f"BS_A_P{n}", "CHASSIS")
    s.tie("R", "R", "75", "0402", "75 1%", "Bob Smith pair B. Own capacitor.", ox + 1680, bs + 72, f"VPORT_N_{n}", f"BS_B_P{n}")
    s.tie("C", "C", "1nF/2kV", "1206", "1nF 2kV", "Bob Smith pair B to chassis", ox + 2160, bs + 72, f"BS_B_P{n}", "CHASSIS")
    s.tie("R", "R", "75", "0402", "75 1%", "Bob Smith pair C", ox + 1680, bs + 144, f"P{n}_LCT_C", f"BS_CD_P{n}")
    s.tie("R", "R", "75", "0402", "75 1%", "Bob Smith pair D into the same node", ox + 1680, bs + 216, f"P{n}_LCT_D", f"BS_CD_P{n}")
    s.tie("C", "C", "1nF/2kV", "1206", "1nF 2kV", "Bob Smith pairs C and D, one capacitor", ox + 2160, bs + 216, f"BS_CD_P{n}", "CHASSIS")

    esd1 = s.add_ic(
        p.ref("D"),
        "ESD_0.3pF",
        ox + 2220,
        oy + 48,
        [(1, "IO1"), (2, "IO2"), (3, "IO3"), (4, "IO4"), (5, "GND")],
        [],
        "functional",
        "TPD4E02B04 x1",
        "Low-cap ESD on cable pairs A and B. Assign the real TPD4E02B04 pinout from the TI datasheet.",
        pitch=30,
        body_w=130,
    )
    esd1r = s.p.parts[-1]["ref"]
    for num, net in {"1": f"P{n}_LA_P", "2": f"P{n}_LA_N", "3": f"P{n}_LB_P", "4": f"P{n}_LB_N", "5": "CHASSIS"}.items():
        x, y, side = esd1[num]
        s.connect((x, y), side, net)
        s.pin_net[f"{esd1r}.{num}"] = net
    esd2 = s.add_ic(
        p.ref("D"),
        "ESD_0.3pF",
        ox + 2220,
        oy + 280,
        [(1, "IO1"), (2, "IO2"), (3, "IO3"), (4, "IO4"), (5, "GND")],
        [],
        "functional",
        "TPD4E02B04 x1",
        "Low-cap ESD on cable pairs C and D. Functional pin numbers.",
        pitch=30,
        body_w=130,
    )
    esd2r = s.p.parts[-1]["ref"]
    for num, net in {"1": f"P{n}_LC_P", "2": f"P{n}_LC_N", "3": f"P{n}_LD_P", "4": f"P{n}_LD_N", "5": "CHASSIS"}.items():
        x, y, side = esd2[num]
        s.connect((x, y), side, net)
        s.pin_net[f"{esd2r}.{num}"] = net
    rj = s.add_ic(
        p.ref("J"),
        "RJ45",
        ox + 2580,
        oy + 48,
        [
            (1, "P1"), (2, "P2"), (3, "P3"), (4, "P4"),
            (5, "P5"), (6, "P6"), (7, "P7"), (8, "P8"), (9, "SH"),
        ],
        [],
        "RJ45 1x1 no magnetics",
        "Shielded RJ45, magnetics are discrete",
        "Tab-down jack. Pins are IEEE pairs: 1-2 A, 3/6 B, 4-5 C, 7-8 D.",
        pitch=30,
        body_w=120,
    )
    jref = s.p.parts[-1]["ref"]
    for num, net in {
        "1": f"P{n}_LA_P", "2": f"P{n}_LA_N", "3": f"P{n}_LB_P", "6": f"P{n}_LB_N",
        "4": f"P{n}_LC_P", "5": f"P{n}_LC_N", "7": f"P{n}_LD_P", "8": f"P{n}_LD_N", "9": "CHASSIS",
    }.items():
        x, y, side = rj[num]
        s.connect((x, y), side, net)
        s.pin_net[f"{jref}.{num}"] = net
    s.note(ox + 2220, oy + 500, "One 100 nF at each PHY 3.3 V pin and each 0.95 V pin. Rails are V3V3 and V095_Pn.", 9)
    for i in range(4):
        s.tie("C", "C", "100nF", "0402", "100nF", "V3V3 at the PHY", ox + 2580, oy + 480 + i * 72, "V3V3", "GND")
        s.tie("C", "C", "100nF", "0402", "100nF", "0.95 V at the PHY", ox + 2580, oy + 768 + i * 72, v09, "GND")
    s.tie("C", "C", "10uF", "0805", "10uF", "PHY 3.3 V bulk", ox + 1680, oy + 1220, "V3V3", "GND")
    s.tie("C", "C", "10uF", "0805", "10uF 6.3V", "PHY 0.95 V bulk", ox + 2160, oy + 1220, v09, "GND")


def sheet_copper(p, title, ports):
    s = p.sheet(title)
    banner(
        s,
        [
            title.replace("_", " "),
            "MDI order is the datasheet default (CFG_OPT1 pulled down): MDIP0 = pair A = RJ45 pins 1-2.",
            "PoE Alt-A uses those center taps. HSIP/HSIN coupling capacitors sit on the switch sheet, next to the SoC.",
            "Bob Smith: pair A and pair B each have their own 75 ohm and 1 nF. Pairs C and D share one capacitor.",
        ],
    )
    y = 120
    for n in ports:
        place_copper(s, p, n, 30, y)
        y += 1400
    return s


SFP_PINS_L = [
    (1, "VEET"), (2, "TX_FAULT"), (3, "TX_DIS"), (4, "SDA"), (5, "SCL"),
    (6, "MOD_ABS"), (7, "RS0"), (8, "RX_LOS"), (9, "RS1"), (10, "VEER"),
]
SFP_PINS_R = [
    (11, "VEER"), (12, "RDN"), (13, "RDP"), (14, "VEER"), (15, "VCCR"),
    (16, "VCCT"), (17, "VEET"), (18, "TDP"), (19, "TDN"), (20, "VEET"),
]


def place_sfp(s, p, n, ox, oy):
    s.rect(ox, oy, 1680, 760, "#eeeeee")
    s.note(ox + 8, oy + 18, f"SFP+ {n}   host pinout SFF-8431   10GBASE-R from the switch SerDes", 12)
    cage = s.add_ic(
        p.ref("J"),
        f"SFP{n}",
        ox + 560,
        oy + 48,
        SFP_PINS_L,
        SFP_PINS_R,
        "SFP+ cage",
        "SFP+ 20-pin host connector",
        "Standard SFP host pins. Cage shield to CHASSIS.",
        pitch=30,
        body_w=170,
    )
    cref = s.p.parts[-1]["ref"]
    nets = {
        "1": "GND", "10": "GND", "11": "GND", "14": "GND", "17": "GND", "20": "GND",
        "2": f"SFP{n}_FAULT", "3": f"SFP{n}_TXDIS", "4": f"SFP{n}_SDA", "5": f"SFP{n}_SCL",
        "6": f"SFP{n}_ABS", "7": f"SFP{n}_RS0", "8": f"SFP{n}_LOS", "9": f"SFP{n}_RS1",
        "12": f"SFP{n}_RDN_P", "13": f"SFP{n}_RDP_P", "15": f"SFP{n}_VCCR", "16": f"SFP{n}_VCCT",
        "18": f"SFP{n}_TDP_P", "19": f"SFP{n}_TDN_P",
    }
    for num, (x, y, side) in cage.items():
        net = nets[num]
        s.connect((x, y), side, net)
        s.pin_net[f"{cref}.{num}"] = net
    dy = 72
    y0 = oy + 56
    s.tie("R", "R", "4.7k", "0402", "4.7k", "TX_FAULT pull-up", ox + 40, y0, "V3V3", f"SFP{n}_FAULT")
    s.tie("R", "R", "10k", "0402", "10k", "TX_DISABLE pull-down keeps the laser enabled", ox + 40, y0 + dy, f"SFP{n}_TXDIS", "GND")
    s.tie("R", "R", "10k", "0402", "10k", "MOD_ABS pull-up", ox + 40, y0 + 2 * dy, "V3V3", f"SFP{n}_ABS")
    s.tie("R", "R", "10k", "0402", "10k", "RX_LOS pull-up", ox + 40, y0 + 3 * dy, "V3V3", f"SFP{n}_LOS")
    s.tie("R", "R", "10k", "0402", "10k", "RS0 pull-down", ox + 40, y0 + 4 * dy, f"SFP{n}_RS0", "GND")
    s.tie("R", "R", "10k", "0402", "10k", "RS1 pull-down", ox + 40, y0 + 5 * dy, f"SFP{n}_RS1", "GND")
    s.tie("R", "R", "4.7k", "0402", "4.7k", "SFP SDA pull-up on the mux channel", ox + 40, y0 + 6 * dy, "V3V3", f"SFP{n}_SDA")
    s.tie("R", "R", "4.7k", "0402", "4.7k", "SFP SCL pull-up on the mux channel", ox + 40, y0 + 7 * dy, "V3V3", f"SFP{n}_SCL")
    rc = ox + 1120
    s.tie("FB", "FB", "600R", "0805", "600R 1A", "VccR ferrite", rc, y0, "V3V3", f"SFP{n}_VCCR")
    s.tie("C", "C", "100nF", "0402", "100nF", "VccR", rc, y0 + dy, f"SFP{n}_VCCR", "GND")
    s.tie("C", "C", "10uF", "0805", "10uF", "VccR bulk", rc, y0 + 2 * dy, f"SFP{n}_VCCR", "GND")
    s.tie("FB", "FB", "600R", "0805", "600R 1A", "VccT ferrite", rc, y0 + 3 * dy, "V3V3", f"SFP{n}_VCCT")
    s.tie("C", "C", "100nF", "0402", "100nF", "VccT", rc, y0 + 4 * dy, f"SFP{n}_VCCT", "GND")
    s.tie("C", "C", "10uF", "0805", "10uF", "VccT bulk", rc, y0 + 5 * dy, f"SFP{n}_VCCT", "GND")
    s.tie("C", "C", "100nF", "0402", "100nF", "TD+ host AC couple", rc, y0 + 6 * dy, f"SFP{n}_TD_P", f"SFP{n}_TDP_P")
    s.tie("C", "C", "100nF", "0402", "100nF", "TD- host AC couple", rc, y0 + 7 * dy, f"SFP{n}_TD_N", f"SFP{n}_TDN_P")
    s.tie("C", "C", "100nF", "0402", "100nF", "RD+ cap. Mark DNP if the module already AC-couples RX.", rc, y0 + 8 * dy, f"SFP{n}_RD_P", f"SFP{n}_RDP_P")
    s.tie("C", "C", "100nF", "0402", "100nF", "RD- cap. Mark DNP if the module already AC-couples RX.", rc, y0 + 9 * dy, f"SFP{n}_RD_N", f"SFP{n}_RDN_P")
    s.note(ox + 40, oy + 720, "TX_DIS, FAULT, ABS, LOS, RS0 and RS1 also land on SoC pins of the same name.", 9)


def sheet_sfp(p):
    s = p.sheet("09_SFP_10G")
    banner(
        s,
        [
            "Four SFP+ cages. A module always answers at 0x50, so a PCA9546A gives each cage its own I2C bus.",
            "The mux master SDA/SCL is the same I2C bus as the TPS23881. Downstream pull-ups are next to each cage.",
        ],
    )
    y = 110
    for n in range(1, 5):
        place_sfp(s, p, n, 30, y)
        y += 800
    s.note(40, y + 10, "PCA9546A I2C mux. Confirm the TSSOP-16 pin order against NXP Fig. 1 before layout.", 12)
    mux = s.add_ic(
        p.ref("U"),
        "PCA9546A",
        520,
        y + 40,
        [(1, "A0"), (2, "A1"), (3, "RESET"), (4, "SD0"), (5, "SC0"), (6, "SD1"), (7, "SC1"), (8, "VSS")],
        [(9, "SC2"), (10, "SD2"), (11, "SC3"), (12, "SD3"), (13, "A2"), (14, "SCL"), (15, "SDA"), (16, "VDD")],
        "TSSOP-16",
        "PCA9546APW",
        "4-channel I2C mux. This TSSOP pin order must be checked against NXP Fig. 1.",
        pitch=30,
        body_w=150,
    )
    mref = s.p.parts[-1]["ref"]
    mux_nets = {
        "1": "GND", "2": "GND", "13": "GND", "3": "SYS_RST_N", "8": "GND", "16": "V3V3",
        "14": "I2C_SCL", "15": "I2C_SDA",
        "4": "SFP1_SDA", "5": "SFP1_SCL", "6": "SFP2_SDA", "7": "SFP2_SCL",
        "10": "SFP3_SDA", "9": "SFP3_SCL", "12": "SFP4_SDA", "11": "SFP4_SCL",
    }
    for num, (x, yy, side) in mux.items():
        net = mux_nets[num]
        s.connect((x, yy), side, net)
        s.pin_net[f"{mref}.{num}"] = net
    s.tie("R", "R", "10k", "0402", "10k", "Mux RESET pull-up", 1100, y + 80, "V3V3", "SYS_RST_N")
    s.tie("C", "C", "100nF", "0402", "100nF", "Mux VDD", 1100, y + 160, "V3V3", "GND")
    s.note(1100, y + 240, "A2:A0 = GND, so the 7-bit address is 0x70. Channels 0 to 3 are SFP 1 to 4.", 10)
    return s


def sheet_soc(p):
    s = p.sheet("10_Switch_SoC")
    banner(
        s,
        [
            "U_SW is a FUNCTIONAL symbol for an RTL9313-class SoC (8x 2.5G SerDes + 4x 10G + DDR3 + SPI).",
            "It is not the Realtek ball map. Bind the vendor BGA and move these net names onto the real pins before layout.",
            "HiSGMII: PHY HSOP/HSON are already AC-coupled. Caps on HSIP/HSIN are here, next to the SoC TX pins.",
        ],
    )
    left = []
    for n in range(1, 9):
        left += [
            (f"R{n}P", f"RX{n}_P"),
            (f"R{n}N", f"RX{n}_N"),
            (f"T{n}P", f"TX{n}_P"),
            (f"T{n}N", f"TX{n}_N"),
        ]
    left += [
        ("MDC", "MDC"), ("MDIO", "MDIO"), ("PRST", "PHY_RST"), ("PINT", "PHY_INT"),
        ("ERST", "PSE_RST"), ("EINT", "PSE_INT"), ("EOSS", "PSE_OSS"),
        ("SCL", "I2C_SCL"), ("SDA", "I2C_SDA"),
    ]
    right = []
    for n in range(1, 5):
        right += [
            (f"ST{n}P", f"SFP{n}_TXP"), (f"ST{n}N", f"SFP{n}_TXN"),
            (f"SR{n}P", f"SFP{n}_RXP"), (f"SR{n}N", f"SFP{n}_RXN"),
            (f"SD{n}", f"SFP{n}_DIS"), (f"SF{n}", f"SFP{n}_FLT"),
            (f"SA{n}", f"SFP{n}_ABS"), (f"SL{n}", f"SFP{n}_LOS"),
        ]
    right += [
        ("CS", "SPI_CS"), ("CK", "SPI_CK"), ("MO", "SPI_MOSI"), ("MI", "SPI_MISO"),
        ("WP", "SPI_WP"), ("HD", "SPI_HOLD"),
        ("UTX", "UART_TX"), ("URX", "UART_RX"),
        ("RST", "SYS_RST"), ("CLK", "CLK25"),
        ("V33", "VDD_3V3"), ("VC", "VDD_CORE"), ("VD", "VDD_DDR"), ("G", "GND"),
        ("DDR", "DDR3_BUS"), ("FAN", "FAN_PWM"),
    ]
    sw = s.add_ic(
        p.ref("U"),
        "RTL9313_FUNC",
        1100,
        140,
        left,
        right,
        "BGA functional",
        "RTL9313-CG functional",
        "Functional SoC only. Nets match the PHY and SFP sheets. Do not route a PCB from these pin numbers.",
        pitch=28,
        body_w=280,
    )
    sref = s.p.parts[-1]["ref"]
    soc_nets = {}
    for n in range(1, 9):
        soc_nets[f"R{n}P"] = f"P{n}_TO_SW_P"
        soc_nets[f"R{n}N"] = f"P{n}_TO_SW_N"
        soc_nets[f"T{n}P"] = f"SW_TXP_{n}"
        soc_nets[f"T{n}N"] = f"SW_TXN_{n}"
    soc_nets.update(
        {
            "MDC": "MDC",
            "MDIO": "MDIO",
            "PRST": "PHY_RST_N",
            "PINT": "PHY_INT_N",
            "ERST": "PSE_RST_N",
            "EINT": "PSE_INT_N",
            "EOSS": "PSE_OSS",
            "SCL": "I2C_SCL",
            "SDA": "I2C_SDA",
            "RST": "SYS_RST_N",
            "CLK": "CLK25_SOC",
            "V33": "V3V3",
            "VC": "V095_SOC",
            "VD": "V1V5",
            "G": "GND",
            "DDR": "DDR3_BUS",
            "FAN": "FAN_PWM",
            "CS": "SPI_CS",
            "CK": "SPI_CLK",
            "MO": "SPI_MOSI",
            "MI": "SPI_MISO",
            "WP": "SPI_WP",
            "HD": "SPI_HOLD",
            "UTX": "UART_TX",
            "URX": "UART_RX",
        }
    )
    for n in range(1, 5):
        soc_nets[f"ST{n}P"] = f"SFP{n}_TD_P"
        soc_nets[f"ST{n}N"] = f"SFP{n}_TD_N"
        soc_nets[f"SR{n}P"] = f"SFP{n}_RD_P"
        soc_nets[f"SR{n}N"] = f"SFP{n}_RD_N"
        soc_nets[f"SD{n}"] = f"SFP{n}_TXDIS"
        soc_nets[f"SF{n}"] = f"SFP{n}_FAULT"
        soc_nets[f"SA{n}"] = f"SFP{n}_ABS"
        soc_nets[f"SL{n}"] = f"SFP{n}_LOS"
    for num, (x, y, side) in sw.items():
        net = soc_nets[num]
        s.connect((x, y), side, net)
        s.pin_net[f"{sref}.{num}"] = net
    for n in range(1, 9):
        s.tie("C", "C", "100nF", "0402", "100nF", f"SoC TX{n}+ AC couple, next to the BGA", 40, 180 + (n - 1) * 72, f"SW_TXP_{n}", f"P{n}_FROM_SW_P")
        s.tie("C", "C", "100nF", "0402", "100nF", f"SoC TX{n}- AC couple, next to the BGA", 520, 180 + (n - 1) * 72, f"SW_TXN_{n}", f"P{n}_FROM_SW_N")
    s.note(40, 820, "Bootstrap resistors on the RTL9313 GPIO strap pins are not drawn. Copy them from the Realtek hardware design guide.", 10)
    s.note(40, 840, "V095_SOC is the buck on sheet 03. It is a different rail from the eight PHY 0.95 V supplies.", 10)
    flash = s.add_ic(
        p.ref("U"),
        "W25Q256",
        1860,
        160,
        [(1, "CS"), (2, "DO"), (3, "WP"), (4, "GND")],
        [(8, "VCC"), (7, "HOLD"), (6, "CLK"), (5, "DI")],
        "SOIC-8",
        "W25Q256JVSSIQ",
        "32 MB SPI NOR. Pinout is the standard Winbond SOIC-8.",
        pitch=32,
        body_w=140,
    )
    fref = s.p.parts[-1]["ref"]
    for num, net in {
        "1": "SPI_CS", "2": "SPI_MISO", "3": "SPI_WP", "4": "GND",
        "5": "SPI_MOSI", "6": "SPI_CLK", "7": "SPI_HOLD", "8": "V3V3",
    }.items():
        x, y, side = flash[num]
        s.connect((x, y), side, net)
        s.pin_net[f"{fref}.{num}"] = net
    ddr = s.add_ic(
        p.ref("U"),
        "DDR3",
        1860,
        400,
        [(1, "VDD"), (2, "VDDQ"), (3, "VREF"), (4, "VSS"), (5, "BUS")],
        [],
        "FBGA-96",
        "MT41K256M16TW-107",
        "512 MB x16 DDR3. Only power and the bus stub are drawn. Connect A/DQ/DQS from the Realtek pin table.",
        pitch=32,
        body_w=160,
    )
    dref = s.p.parts[-1]["ref"]
    for num, net in {"1": "V1V5", "2": "V1V5", "3": "VREF", "4": "GND", "5": "DDR3_BUS"}.items():
        x, y, side = ddr[num]
        s.connect((x, y), side, net)
        s.pin_net[f"{dref}.{num}"] = net
    hdr = s.add_ic(
        p.ref("J"),
        "UART",
        1860,
        680,
        [],
        [(1, "3V3"), (2, "TX"), (3, "RX"), (4, "GND")],
        "HDR-4",
        "1x4 2.54 mm",
        "3.3 V console, 115200 8N1. TX is the SoC transmit pin.",
        pitch=36,
        body_w=110,
    )
    href = s.p.parts[-1]["ref"]
    s.connect((hdr["1"][0], hdr["1"][1]), "R", "V3V3")
    s.connect((hdr["2"][0], hdr["2"][1]), "R", "UART_TX_PIN")
    s.connect((hdr["3"][0], hdr["3"][1]), "R", "UART_RX_PIN")
    s.connect((hdr["4"][0], hdr["4"][1]), "R", "GND")
    s.pin_net[f"{href}.1"] = "V3V3"
    s.pin_net[f"{href}.2"] = "UART_TX_PIN"
    s.pin_net[f"{href}.3"] = "UART_RX_PIN"
    s.pin_net[f"{href}.4"] = "GND"
    osc = s.add_ic(
        p.ref("Y"),
        "25MHz",
        1860,
        920,
        [(1, "EN"), (2, "GND")],
        [(3, "OUT"), (4, "VCC")],
        "3225",
        "25 MHz 3.3 V oscillator",
        "SoC reference. Confirm 25 MHz against the Realtek hardware design guide.",
        pitch=36,
        body_w=120,
    )
    oref = s.p.parts[-1]["ref"]
    for num, net in {"1": "V3V3", "2": "GND", "3": "CLK25_SOC", "4": "V3V3"}.items():
        x, y, side = osc[num]
        s.connect((x, y), side, net)
        s.pin_net[f"{oref}.{num}"] = net
    btn = s.add_ic(
        p.ref("SW"),
        "RESET",
        1860,
        1100,
        [],
        [(1, "A"), (2, "B")],
        "tact",
        "tact switch",
        "Reset button to GND",
        pitch=36,
        body_w=100,
    )
    bref = s.p.parts[-1]["ref"]
    s.connect((btn["1"][0], btn["1"][1]), "R", "SYS_RST_N")
    s.connect((btn["2"][0], btn["2"][1]), "R", "GND")
    s.pin_net[f"{bref}.1"] = "SYS_RST_N"
    s.pin_net[f"{bref}.2"] = "GND"
    fanq = s.add_ic(
        p.ref("Q"),
        "AO3400A",
        1860,
        1280,
        [(1, "G")],
        [(3, "D"), (2, "S")],
        "SOT-23",
        "AO3400A",
        "Fan low-side FET. AOS SOT-23: pin 1 gate, pin 2 source, pin 3 drain. Confirm the mark on the datasheet.",
        pitch=36,
        body_w=120,
    )
    fq = s.p.parts[-1]["ref"]
    for num, net in {"1": "FAN_G", "3": "FAN_N", "2": "GND"}.items():
        x, y, side = fanq[num]
        s.connect((x, y), side, net)
        s.pin_net[f"{fq}.{num}"] = net
    fh = s.add_ic(
        p.ref("J"),
        "FAN",
        1860,
        1460,
        [],
        [(1, "P12"), (2, "N")],
        "HDR-2",
        "fan header",
        "12 V fan. Flyback diode cathode is V12.",
        pitch=36,
        body_w=100,
    )
    fhref = s.p.parts[-1]["ref"]
    s.connect((fh["1"][0], fh["1"][1]), "R", "V12")
    s.connect((fh["2"][0], fh["2"][1]), "R", "FAN_N")
    s.pin_net[f"{fhref}.1"] = "V12"
    s.pin_net[f"{fhref}.2"] = "FAN_N"
    col = 2360
    row = 180
    dy = 72
    parts = [
        ("R", "10k", "0402", "10k", "CS pull-up", "V3V3", "SPI_CS"),
        ("R", "10k", "0402", "10k", "WP pull-up", "V3V3", "SPI_WP"),
        ("R", "10k", "0402", "10k", "HOLD pull-up", "V3V3", "SPI_HOLD"),
        ("C", "100nF", "0402", "100nF", "Flash VCC", "V3V3", "GND"),
        ("C", "100nF", "0402", "100nF", "DDR VDD", "V1V5", "GND"),
        ("C", "10uF", "0805", "10uF", "DDR bulk", "V1V5", "GND"),
        ("R", "100", "0402", "100", "UART TX series", "UART_TX", "UART_TX_PIN"),
        ("R", "100", "0402", "100", "UART RX series", "UART_RX_PIN", "UART_RX"),
        ("C", "100nF", "0402", "100nF", "Oscillator VCC", "V3V3", "GND"),
        ("R", "1.5k", "0402", "1.5k", "MDIO pull-up, one only", "V3V3", "MDIO"),
        ("R", "4.7k", "0402", "4.7k", "I2C SCL pull-up", "V3V3", "I2C_SCL"),
        ("R", "4.7k", "0402", "4.7k", "I2C SDA pull-up", "V3V3", "I2C_SDA"),
        ("R", "10k", "0402", "10k", "PHY reset pull-up", "V3V3", "PHY_RST_N"),
        ("R", "4.7k", "0402", "4.7k", "PHY INT pull-up, open drain", "V3V3", "PHY_INT_N"),
        ("R", "10k", "0402", "10k", "SoC reset pull-up", "V3V3", "SYS_RST_N"),
        ("C", "100nF", "0402", "100nF", "Reset capacitor", "SYS_RST_N", "GND"),
        ("R", "100", "0402", "100", "Fan gate series", "FAN_PWM", "FAN_G"),
        ("R", "100k", "0402", "100k", "Fan gate pulldown", "FAN_G", "GND"),
        ("D", "SS14", "SMA", "SS14", "Fan flyback. Pin 1 anode = drain, pin 2 cathode = V12.", "FAN_N", "V12"),
    ]
    for i, (kind, value, package, mpn, desc, na, nb) in enumerate(parts):
        s.tie(kind, kind if kind != "D" else "D", value, package, mpn, desc, col, row + i * dy, na, nb)
    return s


def validate(project):
    errors = []
    gids = []
    for s in project.sheets:
        blob = "\n".join(s.shapes)
        gids += [m for m in __import__("re").findall(r"gge\d+", blob)]
        pin_pts = set(s.pins.values())
        ends = set(s.wire_ends)
        for x, y, name in s.flag_at:
            if (x, y) not in ends and (x, y) not in pin_pts:
                errors.append(f"{s.title}: flag {name} at {(x, y)} is not on a wire")
        # every connected pin should start a wire
        starts = set()
        for shape in s.shapes:
            if shape.startswith("W~"):
                body = shape.split("~")[1]
                nums = body.split()
                if len(nums) >= 2:
                    starts.add((int(float(nums[0])), int(float(nums[1]))))
        for key, (x, y) in s.pins.items():
            if key in s.pin_net and (x, y) not in starts:
                errors.append(f"{s.title}: pin {key} net {s.pin_net[key]} has no wire")
    dup = [g for g, c in __import__("collections").Counter(gids).items() if c > 1]
    if dup:
        errors.append(f"duplicate gge ids: {dup[:8]}")
    refs = [part["ref"] for part in project.parts]
    dref = [r for r, c in __import__("collections").Counter(refs).items() if c > 1]
    if dref:
        errors.append(f"duplicate refs: {dref[:8]}")
    nets = defaultdict(int)
    for s in project.sheets:
        for _x, _y, name in s.flag_at:
            nets[name] += 1
    must = ["VIN_54V", "GND", "V3V3", "V5", "V12", "V095_SOC", "MDIO", "MDC", "I2C_SCL", "I2C_SDA", "PHY_RST_N", "CHASSIS", "KS_A", "KS_B", "KS_C", "KS_D"]
    for n in range(1, 9):
        must += [f"VPORT_P_{n}", f"VPORT_N_{n}", f"P{n}_TO_SW_P", f"P{n}_FROM_SW_P", f"V095_P{n}", f"EN_095_P{n}"]
    for n in range(1, 5):
        must += [f"SFP{n}_TD_P", f"SFP{n}_SDA", f"SFP{n}_SCL"]
    for s in project.sheets:
        boxes = s.flag_boxes
        for i in range(len(boxes)):
            a = boxes[i]
            for b in boxes[i + 1 :]:
                if a[0] < b[2] - 1 and a[2] > b[0] + 1 and a[1] < b[3] - 1 and a[3] > b[1] + 1:
                    errors.append(f"{s.title}: flags {a[4]} and {b[4]} overlap")
                    if sum(1 for e in errors if e.startswith(s.title + ": flags")) > 12:
                        break
            else:
                continue
            break
        for flag in boxes:
            for body in s.body_boxes:
                if flag[0] < body[2] - 1 and flag[2] > body[0] + 1 and flag[1] < body[3] - 1 and flag[3] > body[1] + 1:
                    errors.append(f"{s.title}: flag {flag[4]} overlaps {body[4]}")
                    break
    for name in must:
        if nets[name] < 2:
            errors.append(f"net {name} has {nets[name]} flags, want >= 2")
    return errors, nets


def write_bom(parts):
    lines = ["Sheet,Ref,Value,Package,MPN,LCSC,Description"]
    for part in parts:
        row = [
            part["sheet"],
            part["ref"],
            part["value"],
            part["package"],
            part["mpn"],
            part["lcsc"],
            part["description"].replace(",", ";"),
        ]
        lines.append(",".join(row))
    with open(BOM, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def write_net_summary(nets):
    lines = [f"{name}\t{count}" for name, count in sorted(nets.items())]
    with open(NET, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def render_svg(sheet, path, scale=0.35):
    pad = 20
    x0 = sheet.minx - pad
    y0 = sheet.miny - pad
    w = (sheet.maxx - sheet.minx) + pad * 2
    h = (sheet.maxy - sheet.miny) + pad * 2
    def tx(x):
        return (x - x0) * scale
    def ty(y):
        return (y - y0) * scale
    bits = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w*scale:.0f}" height="{h*scale:.0f}" viewBox="0 0 {w*scale:.0f} {h*scale:.0f}">',
        '<rect width="100%" height="100%" fill="#ffffff"/>',
    ]
    for item in sheet.draw:
        kind = item[0]
        if kind == "r":
            _, x, y, rw, rh, color = item
            bits.append(
                f'<rect x="{tx(x):.1f}" y="{ty(y):.1f}" width="{rw*scale:.1f}" height="{rh*scale:.1f}" fill="none" stroke="{color}" stroke-width="1"/>'
            )
        elif kind == "w":
            pts = " ".join(f"{tx(x):.1f},{ty(y):.1f}" for x, y in item[1])
            bits.append(f'<polyline points="{pts}" fill="none" stroke="#0a0" stroke-width="1"/>')
        elif kind == "t":
            _, x, y, text, size, color = item
            safe = (
                text.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
            )
            bits.append(
                f'<text x="{tx(x):.1f}" y="{ty(y):.1f}" font-size="{max(6, size*scale*1.6):.1f}" fill="{color}" font-family="sans-serif">{safe}</text>'
            )
        elif kind == "net":
            _, x, y, name, direction = item
            span = max(36, 7 * len(name) + 16)
            if direction == "L":
                pts = [(x, y), (x - 6, y - 6), (x - span, y - 6), (x - span, y + 6), (x - 6, y + 6)]
                text_x = x - span + 4
            else:
                pts = [(x, y), (x + 6, y - 6), (x + span, y - 6), (x + span, y + 6), (x + 6, y + 6)]
                text_x = x + 8
            poly = " ".join(f"{tx(px):.1f},{ty(py):.1f}" for px, py in pts)
            safe = name.replace("&", "&amp;")
            bits.append(f'<polygon points="{poly}" fill="#eef" stroke="#00c" stroke-width="0.6"/>')
            bits.append(
                f'<text x="{tx(text_x):.1f}" y="{ty(y - 8):.1f}" font-size="{max(5, 8 * scale):.1f}" fill="#00c" font-family="sans-serif">{safe}</text>'
            )
        elif kind == "gnd":
            _, x, y, text_side = item
            bits.append(
                f'<line x1="{tx(x):.1f}" y1="{ty(y):.1f}" x2="{tx(x):.1f}" y2="{ty(y + 8):.1f}" stroke="#000" stroke-width="0.8"/>'
            )
            bits.append(
                f'<line x1="{tx(x - 6):.1f}" y1="{ty(y + 8):.1f}" x2="{tx(x + 6):.1f}" y2="{ty(y + 8):.1f}" stroke="#000" stroke-width="0.8"/>'
            )
            label_x = x - 8 if text_side == "L" else x + 4
            anchor = "end" if text_side == "L" else "start"
            bits.append(
                f'<text x="{tx(label_x):.1f}" y="{ty(y + 18):.1f}" font-size="6" fill="#000" text-anchor="{anchor}">GND</text>'
            )
    bits.append("</svg>")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(bits))


def main():
    p = Project()
    sheet_power_in(p)
    sheet_rails(p)
    sheet_core(p)
    sheet_pse(p)
    sheet_poe_ports(p, "05_PoE_Ports_1_4", [1, 2, 3, 4])
    sheet_poe_ports(p, "06_PoE_Ports_5_8", [5, 6, 7, 8])
    sheet_copper(p, "07_Copper_Ports_1_4", [1, 2, 3, 4])
    sheet_copper(p, "08_Copper_Ports_5_8", [5, 6, 7, 8])
    sheet_sfp(p)
    sheet_soc(p)
    errors, nets = validate(p)
    doc = {
        "editorVersion": "6.5.51",
        "docType": "5",
        "title": "PoE_SW_8x2.5G_4xSFP10",
        "description": "8x 2.5GBASE-T PoE+ and 4x 10G SFP+ reference schematic",
        "colors": {},
        "schematics": [s.to_json() for s in p.sheets],
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False)
    write_bom(p.parts)
    write_net_summary(nets)
    preview_dir = "/workspace/hardware/poe-switch-8x2g5-4xsfp/preview"
    import os
    os.makedirs(preview_dir, exist_ok=True)
    os.makedirs("/opt/cursor/artifacts", exist_ok=True)
    for s in p.sheets:
        safe = s.title.replace(" ", "_")
        render_svg(s, f"{preview_dir}/{safe}.svg", 0.28)
        render_svg(s, f"/opt/cursor/artifacts/{safe}.svg", 0.28)
    print(f"sheets={len(p.sheets)} parts={len(p.parts)} nets={len(nets)} gge={p._g}")
    print(f"json_bytes={os.path.getsize(OUT)}")
    if errors:
        print("ERRORS", len(errors))
        for e in errors[:40]:
            print(" -", e)
        raise SystemExit(1)
    print("validation ok")


if __name__ == "__main__":
    main()
