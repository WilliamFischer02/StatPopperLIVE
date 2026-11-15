"""End-to-end: board <-> stats tab linking, reload recovery, practice page, impact picks, setup + replay pages.

Local build (default):  python3 test/e2e_site.py
Live site smoke test:   E2E_BASE=https://stat-pop-board.vercel.app python3 test/e2e_site.py
In live mode the board's files are downloaded from the real site (TLS verified, proxy/CA from the
environment) and served to the test browser under the real origin. StatBroadcast is always the
local mock page; the test never contacts StatBroadcast.
"""
import os
import re
import ssl
import sys
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "test"
MOCK = (ROOT / "test" / "mock-statbroadcast.html").read_text(encoding="utf-8")
MOCK_BB = (ROOT / "test" / "mock-statbroadcast-bb.html").read_text(encoding="utf-8")  # event ids starting with 7
MOCK_BB_PRE = (ROOT / "test" / "mock-statbroadcast-bb-pregame.html").read_text(encoding="utf-8")  # event ids starting with 79
BOARD = os.environ.get("E2E_BASE", "https://board.test").rstrip("/")
LIVE = BOARD != "https://board.test"
TYPES = {".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json"}
CLEAN = {"/": "index.html", "/setup": "setup.html", "/practice": "practice.html", "/practice-bb": "practice-bb.html", "/replay": "replay.html"}
BOOKMARK = f"""(function(){{if(window.SPB&&window.SPB.show){{window.SPB.show();return}}window.__spbOrigin='{BOARD}';var s=document.createElement('script');s.src='{BOARD}/spb.js?v='+Date.now();document.documentElement.appendChild(s)}})();"""
errors, fails = [], []
_live_cache = {}
_ctx_ssl = ssl.create_default_context(cafile=os.environ.get("SSL_CERT_FILE") or ("/root/.ccr/ca-bundle.crt" if os.path.exists("/root/.ccr/ca-bundle.crt") else None))


def live_fetch(url):
    key = url.split("#")[0]
    if key not in _live_cache:
        with urllib.request.urlopen(urllib.request.Request(key, headers={"User-Agent": "spb-e2e"}), context=_ctx_ssl, timeout=20) as res:
            _live_cache[key] = (res.status, res.headers.get("Content-Type", "text/plain"), res.read())
    return _live_cache[key]


def route(r):
    url = r.request.url
    if url.startswith(BOARD):
        if LIVE:
            status, ctype, body = live_fetch(url)
            return r.fulfill(status=status, content_type=ctype, body=body)
        path = url[len(BOARD):].split("?")[0].split("#")[0] or "/"
        f = SITE / CLEAN.get(path, path.lstrip("/"))
        if f.is_file():
            return r.fulfill(status=200, content_type=TYPES.get(f.suffix, "text/plain"), body=f.read_bytes())
        return r.fulfill(status=404, body="not found")
    if url.startswith("https://stats.statbroadcast.com/"):
        return r.fulfill(status=200, content_type="text/html", body=MOCK_BB_PRE if re.search(r"[?&]id=79", url) else MOCK_BB if re.search(r"[?&]id=7", url) else MOCK)
    return r.abort()


def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


def board_state(pg):
    return pg.evaluate("""() => ({
      mode: document.getElementById('mode').textContent.replace(/^[^A-Za-z]+/, ''),
      conn: document.getElementById('conn').textContent,
      home: [...document.querySelectorAll('.q-home .pcard')].map(c => (c.classList.contains('is-star') ? '*' : '') + c.querySelector('.last').textContent),
      away: [...document.querySelectorAll('.q-away .pcard')].map(c => (c.classList.contains('is-star') ? '*' : '') + c.querySelector('.last').textContent),
      team: [...document.querySelectorAll('.tcard .big')].map(e => e.textContent),
      live: [...document.querySelectorAll('.pcard.is-live .last')].map(e => e.textContent),
      title: document.title })""")


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    ctx.route("**/*", route)
    ctx.on("page", lambda pg: pg.on("pageerror", lambda e: errors.append(f"{pg.url}: {e}")))

    # 1. Board opens the stats page from a pasted event number; bookmark starts the reader.
    board = ctx.new_page()
    board.on("pageerror", lambda e: errors.append(f"board: {e}"))
    board.goto(BOARD + "/")
    board.wait_for_timeout(300)
    check(board_state(board)["mode"] == "Waiting", "board starts in Waiting")
    board.fill("#feed", "670274")
    with ctx.expect_page() as popinfo:
        board.click("#feedform button[type=submit]")
    stats = popinfo.value
    stats.wait_for_load_state()
    check("id=670274" in stats.url, "pasted event number opens the stats page")
    stats.evaluate(BOOKMARK)
    start = stats.evaluate("rp.findScore(3, 13, 9)")
    for n in range(start - 3, start + 1):
        stats.evaluate(f"showRally({n})")
        stats.wait_for_timeout(350)
    board.wait_for_timeout(800)
    s1 = board_state(board)
    print("  ", s1)
    check(s1["mode"] == "Live", "board goes Live once the reader runs")
    check(len(s1["home"]) == 3 and len(s1["away"]) == 3, "3 player cards per side")
    dock = stats.evaluate("document.getElementById('spb-dock').shadowRoot.getElementById('dt').textContent")
    check("board linked" in dock, f"stats-tab dock shows the link ({dock})")
    # The mock's team-by-set tables (Set 1, Set 2, Match) and TEAM rows must never become player cards.
    roster = stats.evaluate("[document.querySelectorAll('#t-home tbody tr').length - 2, document.querySelectorAll('#t-away tbody tr').length - 1]")
    summary = [x for x in s1["home"] + s1["away"] if re.match(r"^(set|match|team|totals?|\d+)\b", x, re.I)]
    check(not summary and f"{roster[0]} + {roster[1]} players" in dock,
          f"set, match and team rows are not read as players ({summary or dock}; expected {roster[0]} + {roster[1]})")

    # 2. Impact players: star Greeny (MSU) and Armstrong (UI) from the picker.
    board.click("#starsbtn")
    board.wait_for_timeout(200)
    chips = board.evaluate("[...document.querySelectorAll('.pk-col')].map(c => c.querySelectorAll('.pk-chip').length)")
    check(chips[0] >= 16, f"MSU column lists the full bundled roster ({chips[0]} chips)")
    board.click(".pk-col.side-home .pk-chip:has(.pk-name:text-is('Greeny'))")
    board.click(".pk-col.side-away .pk-chip:has(.pk-name:text-is('Armstrong'))")
    board.wait_for_timeout(200)
    s2 = board_state(board)
    print("  ", s2)
    check("*Greeny" in s2["home"], "starred MSU player always gets a card")
    check("*Armstrong" in s2["away"], "starred opponent always gets a card")
    board.click("button[data-act=pk-close]")
    # Pin an opponent card: it stays on the board while the set goes on.
    pin_key = board.evaluate("document.querySelector('.q-away .pcard:not(.is-star)').dataset.key")
    board.click(f".q-away .pcard[data-key='{pin_key}'] button[data-act=hold]")
    board.wait_for_timeout(200)
    for n in range(start + 1, start + 6):
        stats.evaluate(f"showRally({n})")
        stats.wait_for_timeout(350)
    board.wait_for_timeout(700)
    s3 = board_state(board)
    print("  ", s3)
    check(any(x.startswith("*") for x in s3["home"]), "star rule holds as the set goes on")
    check(any("Run" in t for t in s3["team"]), "team scoring-run card shows during MSU's run")
    pinned = board.evaluate(f"(() => {{ const c = document.querySelector(\".q-away .pcard[data-key='{pin_key}']\"); const b = c && c.querySelector('button[data-act=hold]'); return c ? [c.classList.contains('is-held'), b ? b.textContent : ''] : null; }})()")
    check(bool(pinned and pinned[0] and "Pinned" in pinned[1]), f"pinned card stays on the board ({pin_key}: {pinned})")
    counts = board.evaluate("['home', 'away'].map(s => [document.querySelectorAll('.q-' + s + ' .pcard').length, document.querySelectorAll('.tcol.side-' + s + ' .tcard').length, document.querySelectorAll('.tcol.side-' + s + ' .tline').length])")
    check(all(c[0] == 3 and c[1] == 1 and 3 <= c[2] <= 5 for c in counts), f"each side shows 3 player cards and 1 team card with 3-5 lines ({counts})")
    # Layouts: 5 cards per side, then the full list with the top 3 highlighted and two chosen stats.
    board.click("#layoutseg button[data-layout='5']")
    board.wait_for_timeout(200)
    five = board.evaluate("['home', 'away'].map(s => document.querySelectorAll('.q-' + s + ' .pcard').length)")
    check(five == [5, 5], f"5-per-team layout shows 5 cards per side ({five})")
    board.click("#layoutseg button[data-layout='all']")
    board.select_option("#statA", "tb")
    board.select_option("#statB", "sa")
    board.wait_for_timeout(200)
    lst = board.evaluate("['home', 'away'].map(s => [document.querySelectorAll('.q-' + s + ' .prow').length, document.querySelectorAll('.q-' + s + ' .prow.is-top').length, [...document.querySelectorAll('.q-' + s + ' .prow:first-child .pv .l')].map(e => e.textContent).join('+')])")
    check(lst[0][0] >= roster[0] and lst[1][0] >= roster[1] and lst[0][1] == 3 and lst[1][1] == 3 and lst[0][2] == 'BLK+ACE',
          f"full list shows every player with the top 3 highlighted and the chosen two stats ({lst}; roster {roster})")
    check(board.evaluate("JSON.parse(localStorage.getItem('spb:layout'))") == "all" and board.evaluate("JSON.parse(localStorage.getItem('spb:liststats'))") == ["tb", "sa"], "layout and list stats are remembered")
    board.select_option("#rotate", "15")
    board.wait_for_timeout(100)
    check(board.evaluate("JSON.parse(localStorage.getItem('spb:rotate'))") == 15 and "next in" in board.evaluate("document.getElementById('rotatecount').textContent"), "auto-rotate interval is remembered and counts down")
    board.select_option("#rotate", "0")
    board.click("#layoutseg button[data-layout='3']")
    board.wait_for_timeout(200)
    print("   greyed cards:", board.evaluate("document.querySelectorAll('.pcard.is-dim, .tcard.is-dim').length"))
    board.click(f".q-away .pcard[data-key='{pin_key}'] button[data-act=hold]")
    board.wait_for_timeout(200)
    check(board.evaluate("document.querySelectorAll('.pcard.is-held').length") == 0, "Unpin releases the card")
    # Pass shows an Undo chip in the footer; Undo brings the player straight back.
    pass_key = board.evaluate("document.querySelector('.q-home .pcard:not(.is-star)').dataset.key")
    board.click(f".q-home .pcard[data-key='{pass_key}'] button[data-act=pass]")
    board.wait_for_timeout(200)
    chip = board.evaluate("(() => { const c = document.querySelector('.foot .chip.passed'); return c ? c.textContent : ''; })()")
    gone = board.evaluate(f"!document.querySelector(\".q-home .pcard[data-key='{pass_key}']\")")
    check(gone and "Undo" in chip, f"Pass removes the card and offers Undo ({chip!r})")
    board.click(f".foot .chip.passed button[data-act=unpass][data-key='{pass_key}']")
    board.wait_for_timeout(200)
    check(board.evaluate(f"!!document.querySelector(\".q-home .pcard[data-key='{pass_key}']\") && !document.querySelector('.foot .chip.passed')"), "Undo brings the passed player back")
    # Click a pop line to copy it (the clipboard is stubbed to a window variable here).
    board.evaluate("navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }")
    first_pop = board.evaluate("(() => { const li = document.querySelector('.q-home .pcard .pop[data-copy]'); return li ? li.dataset.copy : ''; })()")
    board.click(".q-home .pcard .pop[data-copy]")
    board.wait_for_timeout(150)
    copied = board.evaluate("window.__copied || ''")
    marked = board.evaluate("!!document.querySelector('.q-home .pcard .pop.copied')")
    check(copied == first_pop and marked and re.match(r"^[A-Z' .-]+ · .+ · \d", copied or ""), f"click copies the pop line ({copied!r})")
    board.click(".tcol.side-home .tline[data-copy]")
    board.wait_for_timeout(150)
    check(board.evaluate("window.__copied") == board.evaluate("document.querySelector('.tcol.side-home .tline[data-copy]').dataset.copy"), "click copies a team line")
    board.screenshot(path=str(SHOTS / "e2e-board.png"))

    # 3. Stats tab reload: the reader restarts and the board relinks by itself.
    stats.reload()
    stats.wait_for_load_state()
    stats.evaluate(f"showRally({start + 6})")
    stats.evaluate(BOOKMARK)
    stats.wait_for_timeout(1500)
    s4 = board_state(board)
    check(s4["mode"] == "Live" and "18" in s4["title"], f"board relinks after the stats tab reloads ({s4['title']})")

    # 4. Reverse direction: reader on a stats page opens the board window.
    ctx2 = b.new_context(viewport={"width": 1440, "height": 900})
    ctx2.route("**/*", route)
    st2 = ctx2.new_page()
    st2.goto("https://stats.statbroadcast.com/broadcast/?id=670274")
    st2.evaluate(f"showRally({start})")
    st2.evaluate(BOOKMARK)
    st2.wait_for_timeout(600)
    with ctx2.expect_page() as pop2:
        st2.locator("#spb-dock").locator("#openwin").click()
    bw = pop2.value
    bw.wait_for_load_state()
    bw.wait_for_timeout(1500)
    s5 = board_state(bw)
    check(s5["mode"] == "Live", f"Open board from the stats tab links the new window ({s5['mode']})")
    # The in-tab "Show here" overlay has the same controls: 5 per team, all players, rotate.
    st2.locator("#spb-dock").locator("#here").click()
    st2.wait_for_timeout(400)
    ov = "document.getElementById('spb-host').shadowRoot"
    check(st2.evaluate(f"{ov}.querySelectorAll('.q-home .pcard').length") == 3 and st2.evaluate(f"!!{ov}.querySelector('#layoutseg')"), "overlay opens with 3 cards and the controls")
    st2.evaluate(f"{ov}.querySelector(\"#layoutseg button[data-layout='5']\").click()")
    st2.wait_for_timeout(300)
    check(st2.evaluate(f"{ov}.querySelectorAll('.q-home .pcard').length") == 5, "overlay switches to 5 per team")
    st2.evaluate(f"{ov}.querySelector(\"#layoutseg button[data-layout='all']\").click()")
    st2.wait_for_timeout(300)
    check(st2.evaluate(f"{ov}.querySelectorAll('.q-home .prow.is-top').length") == 3 and st2.evaluate(f"{ov}.querySelectorAll('.q-home .prow').length") >= 14, "overlay shows the full list")
    st2.evaluate(f"(() => {{ const s = {ov}.querySelector('#rotate'); s.value = '15'; s.dispatchEvent(new Event('change')); }})()")
    st2.wait_for_timeout(1200)
    check("next in" in st2.evaluate(f"{ov}.querySelector('#rotatecount').textContent"), "overlay rotate interval counts down")
    st2.evaluate(f"{ov}.querySelector(\"#layoutseg button[data-layout='3']\").click()")

    # 5. Practice page through the board (reader starts by itself there).
    # The board reuses its stats tab for a new link, so the practice page loads in that same tab.
    board.click("#newlink")
    board.click("#practice")
    stats.wait_for_url("**/practice", timeout=10000)
    board.wait_for_timeout(3500)
    s6 = board_state(board)
    check("practice page" in s6["conn"], f"practice page links to the board ({s6['conn']})")

    # 6. Setup and replay pages load cleanly.
    st = ctx.new_page()
    st.goto(BOARD + "/setup")
    st.wait_for_timeout(400)
    href = st.get_attribute("#bm", "href")
    check(href.startswith("javascript:") and BOARD in href, "setup page builds the bookmark for this site")
    tm = st.input_value("#tmcode")
    check("@match        https://stats.statbroadcast.com/broadcast/*" in tm and "@require" in tm, "setup page shows the Tampermonkey script")
    st.screenshot(path=str(SHOTS / "e2e-setup.png"), full_page=True)
    rpg = ctx.new_page()
    rpg.goto(BOARD + "/replay")
    rpg.wait_for_timeout(500)
    check(rpg.evaluate("document.querySelectorAll('.pcard').length") >= 5, "replay page renders player cards")

    # 7. One-click Tampermonkey script: served, versioned, reader pulled in by @require.
    check(st.get_attribute("#tminstall", "href") == "/stat-pop-board.user.js", "setup page links the one-click Tampermonkey install")
    us = st.evaluate("fetch('/stat-pop-board.user.js').then(r => r.text())")
    board_version = st.evaluate("fetch('/spb.js').then(r => r.text()).then(t => t.match(/version: \"([^\"]+)\"/)[1])")
    m = re.search(r"@require\s+(\S+)/spb\.js\?v=(\S+)", us)
    check("@updateURL" in us and "@downloadURL" in us and f"@version      {board_version}" in us and m and m.group(2) == board_version,
          "Tampermonkey script is versioned, auto-updating, and requires the matching reader")
    check(st.input_value("#tmcode").strip() == us.strip(), "manual-install text matches the one-click script")
    prod = m.group(1) if m else ""

    # 8. Tampermonkey-style start: reader code runs with no script URL and no __spbOrigin (like @require).
    spb_text = live_fetch(BOARD + "/spb.js")[2].decode() if LIVE else (SITE / "spb.js").read_text(encoding="utf-8")
    ctx3 = b.new_context(viewport={"width": 1440, "height": 900})
    ctx3.route("**/*", route)
    st3 = ctx3.new_page()
    st3.on("pageerror", lambda e: errors.append(f"tm-style: {e}"))
    st3.goto("https://stats.statbroadcast.com/broadcast/?id=670274")
    st3.evaluate(f"showRally({start})")
    st3.add_script_tag(content=spb_text)
    st3.wait_for_timeout(500)
    check(st3.evaluate("window.SPB && window.SPB.origin") == prod, f"reader started without a script URL falls back to the live site ({prod})")
    # Only against production: on a preview URL the reader falls back to production, which this test doesn't serve.
    if LIVE and prod == BOARD:
        with ctx3.expect_page() as pop3:
            st3.locator("#spb-dock").locator("#openwin").click()
        bw3 = pop3.value
        bw3.wait_for_load_state()
        bw3.wait_for_timeout(1500)
        check(board_state(bw3)["mode"] == "Live", "Tampermonkey-style reader links to the live board")

    # 9. Board warns when the stats tab runs an older reader than the board.
    old = spb_text.replace(f'version: "{board_version}"', 'version: "0.0.9"', 1)
    st4 = ctx3.new_page()
    st4.goto("https://stats.statbroadcast.com/broadcast/?id=670274")
    st4.evaluate(f"showRally({start})")
    st4.evaluate(f"window.__spbOrigin = {BOARD!r}")
    st4.add_script_tag(content=old)
    st4.wait_for_timeout(400)
    with ctx3.expect_page() as pop4:
        st4.locator("#spb-dock").locator("#openwin").click()
    bw4 = pop4.value
    bw4.wait_for_load_state()
    bw4.wait_for_timeout(2500)
    note = bw4.evaluate("document.getElementById('notice').hidden ? '' : document.getElementById('notice').textContent")
    check("running reader 0.0.9" in note, f"board flags an outdated reader ({note[:70]})")
    ctx3.close()

    # 10. Basketball: the reader tells the sport from the box score, and the board follows.
    ctx5 = b.new_context(viewport={"width": 1440, "height": 900})
    ctx5.route("**/*", route)
    ctx5.on("page", lambda pg: pg.on("pageerror", lambda e: errors.append(f"bb {pg.url}: {e}")))
    bb = ctx5.new_page()
    bb.on("pageerror", lambda e: errors.append(f"bb board: {e}"))
    bb.goto(BOARD + "/")
    bb.fill("#feed", "700001")
    with ctx5.expect_page() as bbpop:
        bb.click("#feedform button[type=submit]")
    bst = bbpop.value
    bst.wait_for_load_state()
    bst.evaluate(BOOKMARK)
    bstart = bst.evaluate("g.find((st) => st.period === 2 && st.clock < 1040)")
    runs_seen, live_seen = [], []
    for n in range(bstart - 4, bstart + 26):
        bst.evaluate(f"showStep({n})")
        bst.wait_for_timeout(260)
        runs_seen += [t for t in bb.evaluate("[...document.querySelectorAll('.tcard .big')].map(e => e.textContent)") if "Run" in t]
        live_seen += bb.evaluate("[...document.querySelectorAll('.pcard.is-live .livedot')].map(e => e.textContent)")
    bb.wait_for_timeout(600)
    sb = board_state(bb)
    print("  ", sb)
    check(sb["mode"] == "Live" and sb["conn"].startswith("Basketball"), f"basketball page is detected and goes Live ({sb['conn'][:50]})")
    pops = bb.evaluate("[...document.querySelectorAll('.pcard .pname')].map(e => e.textContent)")
    check(len(sb["home"]) == 3 and len(sb["away"]) == 3 and pops and not any(x in ("Kills", "Digs", "Attacks", "Aces") for x in pops)
          and any(x in ("Points", "Rebounds", "Shooting", "Points & Rebounds", "3-Pointers", "Assists") for x in pops), f"3 cards per side with basketball pops ({sorted(set(pops))})")
    bdock = bst.evaluate("document.getElementById('spb-dock').shadowRoot.getElementById('dt').textContent")
    junk = [x for x in sb["home"] + sb["away"] if re.match(r"^\*?(team|totals?|game|1st half|\d+)\b", x, re.I)]
    check("8 + 8 players" in bdock and not junk, f"both box styles read; TEAM, Totals and by-period rows are not players ({bdock}; {junk})")
    game = bb.evaluate("({ status: document.querySelector('.sl-pts small').textContent, boxes: [...document.querySelectorAll('.sl-sets small')].map(e => e.textContent), tabs: [...document.querySelectorAll('.tab')].map(e => e.textContent), info: document.querySelector('.serve').textContent })")
    check(bool(re.match(r"^2nd Half · \d{1,2}:\d{2}$", game["status"])) and game["boxes"] == ["pf", "pf"] and game["tabs"] == ["Last play", "Leaders"] and (" by " in game["info"] or "Tied" in game["info"]),
          f"game panel shows the half, clock, whole-game fouls (reader started mid-half) and Leaders tab ({game})")
    title_score = bst.evaluate("document.title.match(/(\\d+), \\w+ (\\d+)/).slice(1, 3).map(Number)")
    check(bb.evaluate("document.querySelector('.sl-pts').firstChild.textContent") == f"{title_score[1]}–{title_score[0]}", f"score matches the stats page title ({title_score})")
    check(len(runs_seen) > 0, f"a scoring run shows on a team card during the home run ({sorted(set(runs_seen))[:3]})")
    check(len(live_seen) > 0, f"cards go live after plays ({sorted(set(live_seen))[:4]})")
    bb.click(".tab[data-tab=rot]")
    bb.wait_for_timeout(150)
    leaders = bb.evaluate("[...document.querySelectorAll('.leaders li')].map(e => e.textContent)")
    check(len(leaders) == 6 and any("PTS" in x for x in leaders), f"Leaders tab lists points, rebounds and assists for both teams ({leaders[:2]})")
    bb.click(".tab[data-tab=plays]")
    # The list's points column adds up to the score, so made-attempted cells and the StatCrew columns both parse.
    bb.click("#layoutseg button[data-layout='all']")
    bb.wait_for_timeout(250)
    lst = bb.evaluate("['home', 'away'].map(s => [document.querySelectorAll('.q-' + s + ' .prow').length, [...document.querySelectorAll('.q-' + s + ' .prow:first-child .pv .l')].map(e => e.textContent).join('+'), [...document.querySelectorAll('.q-' + s + ' .prow .pv:first-child .v')].reduce((a, e) => a + (+e.textContent), 0)])")
    opts = bb.evaluate("[...document.querySelectorAll('#statA option')].map(o => o.value)")
    check(lst[0][0] == 8 and lst[1][0] == 8 and lst[0][1] == "PTS+REB" and "pts" in opts and "k" not in opts and [lst[0][2], lst[1][2]] == [title_score[1], title_score[0]],
          f"list shows every player with PTS and REB, and the points add up to the score ({lst})")
    bb.select_option("#statB", "ast")
    bb.wait_for_timeout(150)
    check(bb.evaluate("JSON.parse(localStorage.getItem('spb:liststats:bb'))") == ["pts", "ast"] and bb.evaluate("localStorage.getItem('spb:liststats')") is None, "basketball list stats are saved apart from volleyball's")
    bb.click("#layoutseg button[data-layout='3']")
    bb.click("#checkbtn")
    bb.wait_for_timeout(200)
    chk = bb.evaluate("document.getElementById('check').textContent")
    check("Basketball" in chk and "Reading OK" in chk and "period 2 of" in chk, "Reader check reports Basketball, the period and the clock")
    bb.click("#checkbtn")
    check("few minutes" in bb.evaluate("document.querySelector('.pcard button[data-act=pass]').title"), "Pass tooltip uses basketball wording")
    bb.screenshot(path=str(SHOTS / "e2e-board-bb.png"))
    # A tab title the reader does not know: the score comes from the box score, the period is left open.
    bst.evaluate("document.title = 'Ridgeline at Montana St. - Live Stats'")
    bb.wait_for_timeout(1200)
    fb = bb.evaluate("({ score: document.querySelector('.sl-pts').firstChild.textContent, status: document.querySelector('.sl-pts small').textContent, conn: document.getElementById('conn').textContent, cards: document.querySelectorAll('.pcard').length })")
    check(fb["score"] == f"{title_score[1]}–{title_score[0]}" and fb["cards"] == 6 and "Ridgeline at Montana St." in fb["conn"], f"an unknown tab title falls back to the box score for the score ({fb})")
    # Same board, a volleyball page next: it switches back by itself.
    bb.click("#newlink")
    bb.fill("#feed", "670274")
    bb.click("#feedform button[type=submit]")
    # Not wait_for_url: on Playwright 1.47 (CI) it misses the load of a same-tab navigation that only changes the query.
    bst.wait_for_function("location.search.includes('670274') && document.readyState === 'complete' && typeof rp !== 'undefined'", timeout=10000)
    bst.evaluate(BOOKMARK)
    vstart = bst.evaluate("rp.findScore(3, 13, 9)")
    for n in range(vstart - 2, vstart + 1):
        bst.evaluate(f"showRally({n})")
        bst.wait_for_timeout(300)
    bb.wait_for_timeout(700)
    sv = board_state(bb)
    vb_ui = bb.evaluate("({ tabs: [...document.querySelectorAll('.tab')].map(e => e.textContent), boxes: [...document.querySelectorAll('.sl-sets small')].map(e => e.textContent), opts: [...document.querySelectorAll('#statA option')].map(o => o.value), pops: [...document.querySelectorAll('.pcard .pname')].map(e => e.textContent) })")
    check(sv["conn"].startswith("Volleyball") and vb_ui["tabs"] == ["Last play", "Rotation"] and vb_ui["boxes"] == ["sets", "sets"] and "k" in vb_ui["opts"] and not any(x in ("Rebounds", "Shooting", "3-Pointers") for x in vb_ui["pops"]),
          f"the board switches back to volleyball on a volleyball page ({sv['conn'][:40]}; {vb_ui['tabs']})")
    # Basketball practice page through the board.
    bb.click("#newlink")
    bb.click("#practicebb")
    bst.wait_for_url("**/practice-bb", timeout=10000)
    bb.wait_for_timeout(4000)
    sp = board_state(bb)
    check(sp["conn"].startswith("Basketball") and "practice page" in sp["conn"] and len(sp["home"]) == 3, f"basketball practice page links to the board ({sp['conn'][:60]})")
    # In-tab overlay on a basketball page.
    bst.locator("#spb-dock").locator("#here").click()
    bst.wait_for_timeout(500)
    ovb = "document.getElementById('spb-host').shadowRoot"
    check(bst.evaluate(f"{ovb}.querySelectorAll('.q-home .pcard').length") == 3 and bst.evaluate(f"[...{ovb}.querySelectorAll('.tab')].map(e => e.textContent).join()") == "Last play,Leaders"
          and bst.evaluate(f"[...{ovb}.querySelectorAll('#statA option')].map(o => o.value).includes('pts')"), "in-tab overlay shows the basketball board")
    ctx5.close()

    # 11. Basketball pregame (the real page's layout, 2026-11-15): no box score, only rosters, then starting lineups.
    ctx6 = b.new_context(viewport={"width": 1440, "height": 900})
    ctx6.route("**/*", route)
    ctx6.on("page", lambda pg: pg.on("pageerror", lambda e: errors.append(f"pregame {pg.url}: {e}")))
    pre = ctx6.new_page()
    pre.on("pageerror", lambda e: errors.append(f"pregame board: {e}"))
    pre.goto(BOARD + "/")
    pre.fill("#feed", "790001")
    with ctx6.expect_page() as prepop:
        pre.click("#feedform button[type=submit]")
    pst = prepop.value
    pst.wait_for_load_state()
    pst.evaluate(BOOKMARK)
    pre.wait_for_timeout(1500)
    sr = board_state(pre)
    print("  ", sr)
    pdock = pst.evaluate("document.getElementById('spb-dock').shadowRoot.getElementById('dt').textContent")
    pstat = pre.evaluate("document.querySelector('.sl-pts small').textContent")
    check(sr["conn"].startswith("Basketball") and "14 + 15 players" in pdock and "Pregame" in pstat, f"pregame roster tables are read as basketball ({pdock}; {pstat})")
    check(sr["home"] == ["Davis", "King", "Praytor"] and sr["away"] == ["Mousa", "Esso Essis", "Ward"], f"pregame cards are each team's top scorers, home team on the home side ({sr['home']} / {sr['away']})")
    ppops = pre.evaluate("[...document.querySelectorAll('.q-home .pcard:first-child .pop')].map(e => e.getAttribute('data-copy'))")
    check(ppops == ["DAVIS · Season Averages · 16.0 PPG · 5.7 RPG · 1.7 APG"], f"a pregame card shows season averages ({ppops})")
    pre.click("#layoutseg button[data-layout='all']")
    pre.wait_for_timeout(250)
    names_all = pre.evaluate("[...document.querySelectorAll('.q-away .prow')].map(e => e.textContent)")
    check(len(names_all) == 15 and any("Price Jr." in x for x in names_all) and not any("Team Averages" in x for x in names_all), f"every roster player is listed; 'Price, Jr.,Aaron' keeps its suffix ({len(names_all)})")
    pre.click("#layoutseg button[data-layout='5']")
    pst.evaluate("showLineups(true)")
    pre.wait_for_timeout(1200)
    sl = board_state(pre)
    pdock = pst.evaluate("document.getElementById('spb-dock').shadowRoot.getElementById('dt').textContent")
    check(sorted(sl["home"]) == ["Davis", "Holden", "King", "Miller", "Steppe"] and sorted(sl["away"]) == ["Esso Essis", "Goode", "Mousa", "Vasilic", "Ward"] and "14 + 15 players" in pdock,
          f"once the starting lineups show, the five cards are the starters and 'Team Averages' is not a player ({sl['home']} / {sl['away']}; {pdock})")
    # A tab title the reader does not know: teams are named from the table headings.
    pst.evaluate("document.title = 'Cal Poly vs. Montana St. - StatBroadcast'")
    pre.wait_for_timeout(1200)
    su = board_state(pre)
    check(sorted(su["home"]) == ["Davis", "Holden", "King", "Miller", "Steppe"] and "CAL POLY at MONTANA ST." in su["conn"], f"pregame still reads under an unknown tab title, teams named from the table headings ({su['conn'][:60]})")
    pre.screenshot(path=str(SHOTS / "e2e-board-bb-pregame.png"))
    ctx6.close()

    board.close()
    check(not errors, "no page errors" + ("" if not errors else ": " + " | ".join(errors[:5])))
    b.close()

print(f"\n{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED'}")
