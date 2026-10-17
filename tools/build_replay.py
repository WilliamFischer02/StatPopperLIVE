"""Parse the transcribed play-by-play into replay JSON and verify it against the final box score."""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "msu-idaho-2026-10-01.txt"
OUT = ROOT / "data" / "replay-msu-idaho.json"

# Final box score, msubobcats.com boxscore.aspx?id=7757 (Oct 1, 2026).
# uni, last, first, k, e, ta, a, setE, sa, se, bs, ba, be, dig, re
BOX = {
    "MSU": [
        (18, "Heidemann", "Karli", 11, 3, 27, 1, 0, 0, 0, 0, 0, 0, 7, 0),
        (22, "Spelts", "Joelie", 11, 0, 13, 0, 0, 0, 1, 0, 1, 0, 2, 0),
        (12, "Thomsen", "Afton", 0, 0, 0, 1, 0, 3, 0, 0, 0, 0, 1, 1),
        (45, "Noble", "Nicolette", 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 9, 1),
        (7, "Schloe", "Lauren", 1, 0, 3, 0, 0, 0, 0, 1, 2, 0, 0, 0),
        (6, "Jaynes", "Teagan", 5, 0, 10, 30, 0, 3, 0, 0, 2, 0, 7, 0),
        (2, "Greeny", "Lauren", 3, 3, 17, 2, 0, 0, 4, 0, 1, 0, 5, 0),
        (5, "Culler", "Keely", 0, 0, 0, 0, 0, 1, 3, 0, 0, 0, 1, 0),
        (23, "Tufto", "Elli", 2, 5, 13, 0, 0, 0, 0, 1, 0, 0, 2, 0),
        (11, "Esko", "Elli", 5, 2, 11, 0, 0, 0, 0, 0, 0, 0, 1, 0),
        (16, "Rich", "Haven", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
        (17, "Steman", "Alice", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
        (13, "Green Ewen", "Jolene", 1, 1, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0),
        (14, "McDonald", "Taylor", 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0),
    ],
    "UI": [
        (16, "Prisby", "Anika", 3, 0, 8, 0, 0, 0, 0, 0, 0, 1, 2, 0),
        (2, "Armstrong", "Alaina", 5, 6, 22, 0, 0, 0, 2, 0, 0, 0, 5, 2),
        (11, "Makaula", "Koen", 5, 0, 9, 0, 0, 0, 0, 0, 1, 0, 1, 0),
        (1, "Wakatake", "Kailee", 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 1, 0),
        (7, "Kleidon", "Keira", 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 11, 2),
        (9, "Greer", "Kiana", 16, 6, 32, 0, 0, 0, 2, 0, 0, 0, 10, 2),
        (21, "Krakoczki", "Csenge", 0, 2, 2, 30, 0, 1, 3, 0, 0, 0, 5, 0),
        (5, "Sullivan", "Sarah", 0, 0, 4, 0, 0, 1, 0, 0, 0, 0, 7, 1),
        (8, "Danielson", "Sophie", 2, 2, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0),
        (12, "Trefren", "Kyriah", 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0),
        (3, "Ryan", "Lucy", 3, 2, 11, 0, 0, 0, 2, 0, 1, 0, 0, 0),
        (6, "Smith", "Gabrielle", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
        (13, "Ferrin", "Allie", 2, 0, 6, 0, 0, 0, 0, 0, 0, 0, 1, 0),
    ],
}
FIELDS = ["k", "e", "ta", "a", "setE", "sa", "se", "bs", "ba", "be", "dig", "re"]

roster = {}  # "Last, First" -> (team, uni)
for team, rows in BOX.items():
    for row in rows:
        uni, last, first = row[:3]
        roster[f"{last}, {first}"] = (team, uni)


def who(name):
    name = name.strip()
    if name not in roster:
        sys.exit(f"Unknown player: {name!r}")
    return roster[name]


def other(team):
    return "UI" if team == "MSU" else "MSU"


rallies, events = [], []
set_no = 0
prev = (0, 0)
for raw in SRC.read_text().splitlines():
    line = raw.strip()
    if not line or (line.startswith("#") and not line.startswith("#SET")):
        continue
    if line.startswith("#SET"):
        set_no = int(line.split()[1])
        prev = (0, 0)
        continue
    parts = line.split("|")
    if parts[0] == "SUB":
        events.append({"type": "console", "set": set_no, "after": len(rallies), "text": parts[1]})
        continue
    serve_team, text, score = parts
    ui, msu = map(int, score.split("-"))
    if (ui - prev[0], msu - prev[1]) not in ((1, 0), (0, 1)):
        sys.exit(f"Score jump in set {set_no}: {prev} -> {(ui, msu)}  {text}")
    winner = "UI" if ui > prev[0] else "MSU"
    prev = (ui, msu)

    server = re.match(r"\[([^\]]+)\]", text).group(1)
    s_team, s_uni = who(server)
    if s_team != serve_team:
        sys.exit(f"Server team mismatch: {text}")
    body = text[text.index("]") + 1 :].strip()
    acts = []
    implied = None
    if m := re.match(r"Kill by ([^(,.]+, [^(,.]+?)(?: \(from ([^)]+)\))?(?:, block error by ([^.]+))?\.$", body):
        kt, ku = who(m.group(1))
        acts.append({"t": "kill", "team": kt, "uni": ku})
        if m.group(2):
            at, au = who(m.group(2))
            if at == kt:  # a cross-team "from" is a scorer quirk; no assist
                acts.append({"t": "assist", "team": at, "uni": au})
        if m.group(3):
            bt, bu = who(m.group(3))
            acts.append({"t": "blockError", "team": bt, "uni": bu})
        implied = kt
    elif m := re.match(r"Attack error by ([^(.]+, [^(.]+?)(?: \((from|block by) ([^)]+)\))?\.$", body):
        et, eu = who(m.group(1))
        acts.append({"t": "attackError", "team": et, "uni": eu})
        if m.group(2) == "block by":
            blockers = [who(b) for b in m.group(3).split(";")]
            kind = "blockSolo" if len(blockers) == 1 else "blockAssist"
            for bt, bu in blockers:
                acts.append({"t": kind, "team": bt, "uni": bu})
        implied = other(et)
    elif m := re.match(r"Service ace \(([^)]+)\)\.$", body):
        rt, ru = who(m.group(1))
        acts.append({"t": "ace", "team": s_team, "uni": s_uni})
        acts.append({"t": "receptionError", "team": rt, "uni": ru})
        implied = s_team
    elif body == "Service error.":
        acts.append({"t": "serviceError", "team": s_team, "uni": s_uni})
        implied = other(s_team)
    elif m := re.match(r"Bad set by ([^.]+)\.$", body):
        bt, bu = who(m.group(1))
        acts.append({"t": "setError", "team": bt, "uni": bu})
        implied = other(bt)
    else:
        sys.exit(f"Unparsed play: {text}")
    if implied != winner:
        sys.exit(f"Play implies {implied} point but score says {winner}: set {set_no} {text}")
    rallies.append({"set": set_no, "serveTeam": serve_team, "server": s_uni,
                    "text": text, "ui": ui, "msu": msu, "winner": winner, "acts": acts})

# Rebuild exact counting stats from the plays and compare with the box score.
calc = {(t, r[0]): dict.fromkeys(FIELDS, 0) for t, rows in BOX.items() for r in rows}
key = {"kill": "k", "assist": "a", "attackError": "e", "ace": "sa", "receptionError": "re",
       "serviceError": "se", "blockSolo": "bs", "blockAssist": "ba", "setError": "setE", "blockError": "be"}
for r in rallies:
    for a in r["acts"]:
        calc[(a["team"], a["uni"])][key[a["t"]]] += 1

exact = ["k", "e", "sa", "se", "bs", "ba", "re", "a", "setE", "be"]
problems = []
for team, rows in BOX.items():
    for row in rows:
        box = dict(zip(FIELDS, row[3:]))
        got = calc[(team, row[0])]
        for f in exact:
            if got[f] != box[f]:
                problems.append(f"{team} #{row[0]} {row[1]}: {f} pbp={got[f]} box={box[f]}")

sets = {}
for r in rallies:
    sets[r["set"]] = (r["ui"], r["msu"])
print("Rallies:", len(rallies), "| console-only events:", len(events))
print("Set finals (UI-MSU):", sets)
print("Box-score mismatches on exact stats:", len(problems))
for p in problems:
    print("  ", p)

out = {
    "match": {"date": "2026-10-01", "venue": "Shroyer Gym, Bozeman, MT", "sport": "vb",
              "home": {"code": "MSU", "name": "Montana St."}, "away": {"code": "UI", "name": "Idaho"},
              "source": "https://msubobcats.com/boxscore.aspx?id=7757",
              # Total attacks per set from the box score's Match Details table.
              "setTA": {"MSU": [32, 30, 36], "UI": [38, 27, 34]}},
    "roster": {t: [{"uni": r[0], "last": r[1], "first": r[2]} for r in rows] for t, rows in BOX.items()},
    "finals": {t: {str(r[0]): dict(zip(FIELDS, r[3:])) for r in rows} for t, rows in BOX.items()},
    "rallies": rallies,
    "events": events,
}
OUT.write_text(json.dumps(out, separators=(",", ":")))
print("Wrote", OUT, f"({OUT.stat().st_size // 1024} KB)")

# Compact source for the site build (tools/build_site.py): the box score plus the play-by-play text
# without its # comment lines. The browser rebuilds the replay from it with src/replay-parse.js.
SRC_OUT = ROOT / "data" / "replay-src.json"
pbp = "\n".join(l for l in SRC.read_text().splitlines() if l.strip() and (not l.startswith("#") or l.startswith("#SET")))
SRC_OUT.write_text(json.dumps({"match": out["match"], "box": {t: [list(r) for r in rows] for t, rows in BOX.items()}, "pbp": pbp}, separators=(",", ":")))
print("Wrote", SRC_OUT, f"({SRC_OUT.stat().st_size // 1024} KB)")
