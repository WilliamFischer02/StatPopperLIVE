"""Build the Vercel site into site/: board, setup, practice and replay pages plus the shared reader bundle.

  python3 tools/build_site.py          rebuild site/ and vercel.json (commit both)
  python3 tools/build_site.py --check  exit 1 if site/ or vercel.json are out of date with src/ and data/

site/ is committed and Vercel serves it as-is (no build step on Vercel). Never edit site/ by hand.
Bump VERSION for every user-visible change: it cache-busts ?v= URLs and shows in the board's Reader check.
"""
import argparse
import filecmp
import html
import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC, DATA, SITE = ROOT / "src", ROOT / "data", ROOT / "site"
args = argparse.ArgumentParser(description=__doc__.splitlines()[0])
args.add_argument("--check", action="store_true", help="build to a temp folder and compare with site/")
args = args.parse_args()
OUT = Path(tempfile.mkdtemp(prefix="spb-site-")) if args.check else SITE
VERSION = "0.3.0"
# Where the live site is served. The reader falls back to this when nothing else tells it where the board is
# (Tampermonkey's @require gives it no script URL), and the one-click Tampermonkey script points here.
PROD_ORIGIN = "https://stat-pop-board.vercel.app"
FONTS = "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap"
TRAILER = "})(typeof globalThis !== 'undefined' ? globalThis : this);"

read = lambda n: (SRC / n).read_text(encoding="utf-8")


def write(path, text):
    """Write with LF line endings on every OS, so site/ is byte-identical whether built on Windows or Linux."""
    path.write_text(text, encoding="utf-8", newline="\n")


if OUT.exists():
    shutil.rmtree(OUT)
(OUT / "assets").mkdir(parents=True)


def private(name):
    code = read(name)
    assert TRAILER in code, name
    return code.replace(TRAILER, "})(SPB);")


roster = json.loads((DATA / "msu-wvb-roster-2026.json").read_text(encoding="utf-8"))["players"]

bundle = f"""/* Stat Pop Board {VERSION}: reads only the page you have open and shares it with the board window on this computer. */
(function () {{
'use strict';
if (window.SPB && window.SPB.version) {{ if (!window.__spbNoReader && window.SPB.show) window.SPB.show(); return; }}
var cs = document.currentScript;
var SPB = {{ version: {json.dumps(VERSION)} }};
SPB.origin = window.__spbOrigin || (cs && cs.src ? new URL(cs.src, location.href).origin : null) || {json.dumps(PROD_ORIGIN)};
SPB.cssHref = SPB.origin ? SPB.origin + '/assets/board.css?v={VERSION}' : null;
SPB.fontsHref = {json.dumps(FONTS)};
SPB.rosters = {{ msuVolleyball: {json.dumps(roster, separators=(",", ":"))} }};
{private("engine.js")}
{private("view.js")}
{private("picker.js")}
{read("reader.js")}
window.SPB = SPB;
if (!window.__spbNoReader) {{ var r = startReader(SPB); SPB.show = r.show; }}
}})();
"""
write(OUT / "spb.js", bundle)
write(OUT / "assets" / "board.css", read("styles.css") + "\n" + read("site.css"))
src = json.loads((DATA / "replay-src.json").read_text(encoding="utf-8"))
assert "`" not in src["pbp"] and "${" not in src["pbp"]
box_js = "{\n" + ",\n".join(f'"{t}":[\n' + ",\n".join(json.dumps(r, separators=(",", ":")) for r in rows) + "]" for t, rows in src["box"].items()) + "}"
replay_src_js = ("window.REPLAY_DATA=ReplayParse.build({\nmatch:" + json.dumps(src["match"], separators=(",", ":"))
                 + ",\nbox:" + box_js + ",\npbp:`" + src["pbp"] + "`});\n")
write(OUT / "assets" / "replay.js", read("replay.js") + "\n" + read("replay-parse.js") + "\n" + replay_src_js)
for src, dst in [("app-live.js", "live.js"), ("app-replay.js", "replay-app.js"), ("app-practice.js", "practice.js"), ("app-setup.js", "setup.js")]:
    write(OUT / "assets" / dst, read(src))

# Tampermonkey script. The reader comes in through @require, which Tampermonkey downloads itself, so a stats page
# that blocks outside <script> tags can't stop it. @updateURL lets Tampermonkey pick up new versions on its own.
USERSCRIPT = f"""// ==UserScript==
// @name         Stat Pop Board reader
// @namespace    goob-entertainment.stat-pop-board
// @version      {VERSION}
// @description  Starts the Stat Pop Board reader on StatBroadcast pages. It reads only the page you have open.
// @match        https://stats.statbroadcast.com/broadcast/*
// @match        https://*.statbroadcast.com/broadcast/*
// @require      {PROD_ORIGIN}/spb.js?v={VERSION}
// @updateURL    {PROD_ORIGIN}/stat-pop-board.user.js
// @downloadURL  {PROD_ORIGIN}/stat-pop-board.user.js
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==
// The reader itself arrives through @require above and starts on its own. Nothing else to do here.
"""
write(OUT / "stat-pop-board.user.js", USERSCRIPT)

write(OUT / "favicon.svg",
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0f1317"/>'
    '<rect x="6" y="7" width="20" height="5" rx="1.5" fill="#4f8ff0"/><rect x="6" y="14" width="20" height="5" rx="1.5" fill="#cdb57a"/>'
    '<rect x="6" y="21" width="13" height="5" rx="1.5" fill="#ff4b3e"/></svg>')


def head(title, desc, board_css=True):
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{FONTS}">
{'<link rel="stylesheet" href="/assets/board.css?v=' + VERSION + '">' if board_css else ''}"""


BRAND = '<a class="brand" href="/" style="text-decoration:none;color:inherit"><b>Stat Pop Board</b></a>'

write(OUT / "index.html", head("Stat Pop Board", "Second-monitor board that pulls pop-worthy stats from the StatBroadcast page you have open.") + f"""
<script>window.__spbNoReader = true;</script>
<script src="/spb.js?v={VERSION}"></script>
</head>
<body>
<div class="app">
  <header class="bar">
    <div class="brand"><b>Stat Pop Board</b><span class="mode wait" id="mode">Waiting</span></div>
    <span class="matchline" id="conn">Not linked to a stats page yet</span>
    <div class="transport">
      <button class="tbtn gold" id="starsbtn" type="button" aria-pressed="false">&#9733; Impact players</button>
      <button class="tbtn" id="swap" type="button" title="Swap which team sits on the left">Swap sides</button>
      <button class="tbtn" id="checkbtn" type="button" aria-pressed="false">Reader check</button>
      <button class="tbtn" id="newlink" type="button" hidden>New link</button>
      <button class="tbtn" id="fs" type="button">Full screen</button>
      <nav class="navlinks"><a href="/setup">Setup</a></nav>
    </div>
  </header>
  <div id="notice" class="notice" role="status" hidden></div>
  <section id="picker" aria-label="Impact players" hidden></section>
  <section id="check" class="check" aria-label="Reader check" hidden></section>
  <section id="start" class="start" aria-label="Link a stats page">
    <h1>Link a stats page</h1>
    <p class="lead">Paste the game&rsquo;s StatBroadcast link, or just its event number. This board opens the stats page in a new tab and fills in once that page shows the box score.</p>
    <form id="feedform" class="feed" autocomplete="off">
      <label for="feed">StatBroadcast link or event ID</label>
      <div class="feedrow"><input id="feed" type="text" inputmode="url" spellcheck="false" placeholder="https://stats.statbroadcast.com/broadcast/?id=670274"><button class="tbtn primary" type="submit">Open stats page</button></div>
      <p class="hint" id="feedhint">Find it on <a href="https://msubobcats.com/calendar" target="_blank" rel="noopener">msubobcats.com &rarr; Schedule</a>: the game&rsquo;s &ldquo;Stats&rdquo; link.</p>
    </form>
    <ol class="steps">
      <li><b>Accept &amp; Continue</b> on the stats page.</li>
      <li><b>Start the reader</b> there: click your <i>Pop board</i> bookmark (it starts by itself if you use Tampermonkey). A small Pop board bar appears at the bottom-right.</li>
      <li><b>Put the windows side by side</b>: stats page on one monitor, this board on the other.</li>
    </ol>
    <div class="recentlinks" id="recentlinks"></div>
    <p class="morelinks"><a href="/setup">Set up the reader</a><button class="linkbtn" id="practice" type="button">Try the practice page</button><a href="/replay">Replay demo</a></p>
  </section>
  <div id="board" hidden></div>
</div>
<script src="/assets/live.js?v={VERSION}"></script>
</body>
</html>
""")

write(OUT / "setup.html", head("Pop Board Setup", "How to start the Stat Pop Board reader on a StatBroadcast page.") + f"""
</head>
<body>
<main class="page">
  <header class="bar">{BRAND}<nav class="navlinks" style="margin-left:auto"><a href="/">Board</a><a href="/practice">Practice page</a><a href="/replay">Replay</a></nav></header>
  <div style="display:grid;gap:8px">
    <h1>Set up the reader</h1>
    <p class="lead">The board can&rsquo;t see the stats page by itself: browsers keep sites walled off from each other. A small reader runs in the stats tab and passes what it reads to the board window on the same computer. Pick one way to start it.</p>
    <p class="small"><b>Which one?</b> Start with the bookmark: nothing to install. If clicking it shows &ldquo;blocked&rdquo;, the console paste always works. Tampermonkey is the hands-free option if the computer lets you add extensions.</p>
  </div>

  <section class="opt">
    <h2>1 &middot; Bookmark button <small>No install. Best for a work computer.</small></h2>
    <ol>
      <li>Show the bookmarks bar: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>.</li>
      <li>Drag this button onto the bar: <a class="bookmarklet" id="bm" href="#">Pop board</a></li>
      <li>On the stats page, after <b>Accept &amp; Continue</b>, click the bookmark once. A Pop board bar appears at the bottom-right.</li>
    </ol>
    <div class="row"><button class="tbtn" id="copybm" type="button">Copy bookmark code</button><span id="bmnote" class="copied"></span></div>
    <p class="small">Can&rsquo;t drag? Right-click the bookmarks bar &rarr; <b>Add page</b>, name it Pop board, and paste the copied code as the URL.</p>
    <textarea id="bmcode" readonly rows="2" style="width:100%;font-family:var(--font-data);font-size:12px;background:var(--ground);color:var(--ink-2);border:1px solid var(--rule);border-radius:6px;padding:8px" aria-label="Bookmark code"></textarea>
  </section>

  <section class="opt">
    <h2>2 &middot; Paste into the console <small>If bookmarks are locked, or the bookmark shows &ldquo;blocked&rdquo;.</small></h2>
    <ol>
      <li>Click <b>Copy reader code</b>: <button class="tbtn" id="copyreader" type="button">Copy reader code</button> <span id="readernote" class="copied"></span></li>
      <li>On the stats page press <kbd>F12</kbd> (or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>J</kbd>) and open <b>Console</b>.</li>
      <li>If Chrome warns about pasting, type <code>allow pasting</code> and press <kbd>Enter</kbd> first.</li>
      <li>Paste with <kbd>Ctrl</kbd>+<kbd>V</kbd>, press <kbd>Enter</kbd>, then close the console.</li>
    </ol>
    <p class="small">You&rsquo;ll repeat this each time you open or reload the stats page.</p>
  </section>

  <section class="opt" id="tampermonkey">
    <h2>3 &middot; Tampermonkey <small>Starts by itself every time you open a stats page. Needs a browser extension.</small></h2>
    <ol>
      <li><b>Add Tampermonkey</b> from your browser&rsquo;s extension store: the Chrome Web Store in Chrome, or Edge Add-ons in Edge. If the store says the extension is <b>blocked by your organization</b>, stop here and use the bookmark instead.</li>
      <li><b>Let it run scripts.</b> Browsers now keep this off until you turn it on:
        <ul>
          <li><b>Chrome 138 or newer:</b> click the puzzle-piece Extensions icon, then the &#8942; menu next to Tampermonkey &rarr; <b>Manage extension</b>. Turn on <b>Allow User Scripts</b>.</li>
          <li><b>Older Chrome, or Edge:</b> type <code>chrome://extensions</code> (Edge: <code>edge://extensions</code>) in the address bar and turn on <b>Developer mode</b>.</li>
        </ul>
        Not sure which Chrome you have? Do the first one; if there&rsquo;s no Allow User Scripts switch, do the second.</li>
      <li><b>Install the reader script:</b> <a class="bookmarklet" id="tminstall" href="/stat-pop-board.user.js">Install reader script</a> Tampermonkey opens its own install page. Click <b>Install</b>.</li>
      <li><b>Check it:</b> open or reload any StatBroadcast stats page. The Pop board bar appears at the bottom-right by itself, and the Tampermonkey icon shows a <b>1</b>.</li>
    </ol>
    <p class="small"><b>Updates:</b> Tampermonkey checks this site for new versions on its own. To update right away, open the Tampermonkey menu &rarr; <b>Check for userscript updates</b>. The board tells you when the stats tab is running an older reader.</p>
    <p class="small"><b>Nothing happens on the stats page?</b> Open the Tampermonkey menu on that page. If it says scripts are disabled, step 2 isn&rsquo;t done; if <i>Stat Pop Board reader</i> is listed but switched off, switch it on and reload.</p>
    <details>
      <summary class="small">Install by hand instead (if the install button doesn&rsquo;t open Tampermonkey)</summary>
      <ol>
        <li>Tampermonkey menu &rarr; <b>Create a new script</b>, select everything in the editor and delete it.</li>
        <li>Paste the script below, then <b>File &rarr; Save</b>.</li>
      </ol>
      <div class="row"><button class="tbtn" id="copytm" type="button">Copy Tampermonkey script</button><span id="tmnote" class="copied"></span></div>
      <textarea id="tmcode" readonly rows="10" style="width:100%;font-family:var(--font-data);font-size:12px;background:var(--ground);color:var(--ink-2);border:1px solid var(--rule);border-radius:6px;padding:8px" aria-label="Tampermonkey script">{html.escape(USERSCRIPT)}</textarea>
    </details>
  </section>

  <section class="opt">
    <h2>Test it before a match</h2>
    <ol>
      <li>Open the <a href="/">board</a> and click <b>Try the practice page</b>. It opens a stand-in stats page that replays MSU vs Idaho; the reader starts there by itself.</li>
      <li>To test your bookmark: open the <a href="/practice?manual=1">practice page in manual mode</a>, click your <b>Pop board</b> bookmark, then click <b>Open board</b> in the bar that appears.</li>
      <li>To test on the real StatBroadcast site before game time: paste the stats link of any <b>finished</b> match into the board, start the reader there, and open <b>Reader check</b>. If it says <b>Reading OK</b> and lists both teams&rsquo; players, you&rsquo;re set. If not, click <b>Copy for Claude</b> and send it.</li>
    </ol>
    <p class="small">The practice page&rsquo;s layout is a guess at StatBroadcast&rsquo;s, so it tests your setup, not the real page. On game day, <b>Reader check</b> on the board shows exactly what was read from the real page.</p>
  </section>

  <p class="small">What it reads: the score in the stats tab&rsquo;s title, the box-score tables, and new play-by-play lines. It sends them only to the board window on this computer. Nothing goes to a server; your impact-player picks and hidden players are saved in this browser.</p>
</main>
<script src="/assets/setup.js?v={VERSION}"></script>
</body>
</html>
""")

write(OUT / "replay.html", head("Pop Board Replay", "The Stat Pop Board stepping through MSU vs Idaho (Oct 1, 2026) rally by rally.") + f"""
<script>window.__spbNoReader = true;</script>
<script src="/spb.js?v={VERSION}"></script>
</head>
<body>
<div class="app">
  <header class="bar">
    <div class="brand"><a href="/" style="text-decoration:none;color:inherit"><b>Stat Pop Board</b></a><span class="mode replay">Replay</span></div>
    <span class="matchline">MSU vs Idaho &middot; Oct 1, 2026 &middot; official play-by-play</span>
    <div class="transport">
      <button class="tbtn" id="back" type="button" aria-label="Previous rally">&#9664;</button>
      <button class="tbtn" id="play" type="button" aria-pressed="false">Play</button>
      <button class="tbtn" id="fwd" type="button" aria-label="Next rally">&#9654;</button>
      <select class="speed" id="speed" aria-label="Replay speed">
        <option value="2500">1 rally / 2.5 s</option>
        <option value="1200" selected>1 rally / 1.2 s</option>
        <option value="500">1 rally / 0.5 s</option>
      </select>
      <div class="scrub"><input type="range" id="scrub" min="0" max="137" value="0" aria-label="Rally"><output id="where" for="scrub"></output></div>
      <button class="tbtn" type="button" data-jump="1">Set 1</button>
      <button class="tbtn" type="button" data-jump="2">Set 2</button>
      <button class="tbtn" type="button" data-jump="3">Set 3</button>
      <button class="tbtn gold" id="starsbtn" type="button" aria-pressed="false">&#9733; Impact players</button>
    </div>
  </header>
  <section id="picker" aria-label="Impact players" hidden></section>
  <div id="board"></div>
</div>
<script src="/assets/replay.js?v={VERSION}"></script>
<script src="/assets/replay-app.js?v={VERSION}"></script>
</body>
</html>
""")

write(OUT / "practice.html", head("UI 0, MSU 0 - SET 1", "Practice stand-in for a StatBroadcast page.", board_css=False) + f"""
<style>
  body {{ margin: 0; background: #f4f5f7; color: #111; font: 13px/1.35 Arial, Helvetica, sans-serif; }}
  .banner {{ background: #10161c; color: #edf1f4; padding: 10px 16px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; font: 500 14px/1.3 system-ui, "Segoe UI", sans-serif; }}
  .banner b {{ font-weight: 700; }}
  .banner button, .banner select {{ font: 600 13px system-ui, sans-serif; border-radius: 6px; border: 1px solid #3a4652; background: #1c242c; color: #edf1f4; padding: 5px 10px; cursor: pointer; }}
  .banner a {{ color: #6fb4ff; }}
  .banner .where {{ font-family: ui-monospace, Menlo, Consolas, monospace; color: #a5b1bc; }}
  .wrap {{ max-width: 1100px; margin: 0 auto; padding: 12px 16px 80px; display: grid; gap: 10px; }}
  h4 {{ margin: 4px 0 0; font-size: 18px; }}
  h5 {{ margin: 8px 0 2px; font-size: 14px; }}
  #console {{ border: 1px solid #b9bec6; background: #fff; padding: 6px 8px; font-weight: 700; }}
  .tables {{ overflow-x: auto; }}
  table {{ border-collapse: collapse; background: #fff; }}
  th, td {{ border: 1px solid #c9ced6; padding: 2px 6px; text-align: right; }}
  th {{ background: #e6e9ee; }}
  td:nth-child(2), th:nth-child(2) {{ text-align: left; }}
  tr.tot td {{ font-weight: 700; background: #f0f2f5; }}
  #pbp {{ margin: 0; padding-left: 18px; color: #333; }}
</style>
</head>
<body>
<div class="banner" role="region" aria-label="Practice controls">
  <span><b>Practice page</b> &middot; a stand-in stats page replaying MSU vs Idaho (Oct 1) so you can test the reader and board.</span>
  <button id="play" type="button">Pause</button>
  <button id="fwd" type="button">Next rally</button>
  <select id="speed" aria-label="Speed"><option value="1500">1 rally / 1.5 s</option><option value="3000" selected>1 rally / 3 s</option><option value="6000">1 rally / 6 s</option></select>
  <button id="restart" type="button">Restart</button>
  <span class="where" id="where"></span>
  <a href="/">Board</a>
</div>
<div class="wrap">
  <h4>Idaho at Montana St.</h4>
  <div id="console">Waiting</div>
  <table id="line"><tr><th></th><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th></tr>
    <tr><td>UI</td><td></td><td></td><td></td><td></td><td></td></tr><tr><td>MSU</td><td></td><td></td><td></td><td></td><td></td></tr></table>
  <div class="tables"><h5>Idaho</h5><table id="t-away"></table></div>
  <div class="tables"><h5>Montana St.</h5><table id="t-home"></table></div>
  <div><h5>Recent plays</h5><ol id="pbp" reversed></ol></div>
</div>
<script src="/assets/replay.js?v={VERSION}"></script>
<script src="/assets/practice.js?v={VERSION}"></script>
<script>
  // The reader starts by itself here, as if it were installed. ?manual=1 leaves it to your bookmark.
  if (new URLSearchParams(location.search).get('manual') !== '1') {{
    var s = document.createElement('script'); s.src = '/spb.js?v={VERSION}'; document.body.appendChild(s);
  }}
</script>
</body>
</html>
""")

VERCEL = json.dumps({
    "$schema": "https://openapi.vercel.sh/vercel.json",
    "framework": None,
    "installCommand": "echo 'No install step: site/ is prebuilt.'",
    "buildCommand": "echo 'No build step: site/ is prebuilt by tools/build_site.py.'",
    "outputDirectory": "site",
    "cleanUrls": True,
    "headers": [
        {"source": "/spb.js", "headers": [
            {"key": "Cache-Control", "value": "public, max-age=0, must-revalidate"},
            {"key": "Access-Control-Allow-Origin", "value": "*"},
            {"key": "Cross-Origin-Resource-Policy", "value": "cross-origin"}]},
        {"source": "/assets/(.*)", "headers": [
            {"key": "Access-Control-Allow-Origin", "value": "*"},
            {"key": "Cross-Origin-Resource-Policy", "value": "cross-origin"}]},
    ],
}, indent=2) + "\n"

if args.check:
    stale = []
    built = sorted(f.relative_to(OUT) for f in OUT.rglob("*") if f.is_file())
    have = sorted(f.relative_to(SITE) for f in SITE.rglob("*") if f.is_file()) if SITE.exists() else []
    stale += [f"site/{f} (missing)" for f in built if f not in have]
    stale += [f"site/{f} (not produced by the build)" for f in have if f not in built]
    stale += [f"site/{f}" for f in built if f in have and not filecmp.cmp(OUT / f, SITE / f, shallow=False)]
    vj = ROOT / "vercel.json"
    if not vj.exists() or vj.read_text(encoding="utf-8") != VERCEL:
        stale.append("vercel.json")
    shutil.rmtree(OUT)
    if stale:
        print("Out of date (run python3 tools/build_site.py and commit):\n  " + "\n  ".join(stale))
        sys.exit(1)
    print(f"site/ and vercel.json are up to date (v{VERSION}).")
    sys.exit(0)

write(ROOT / "vercel.json", VERCEL)
total = 0
for f in sorted(OUT.rglob("*")):
    if f.is_file():
        total += f.stat().st_size
        print(f"{f.relative_to(OUT)}: {f.stat().st_size / 1024:.1f} KB")
print(f"total {total / 1024:.1f} KB  (v{VERSION})")
