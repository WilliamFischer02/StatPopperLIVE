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
BOARD = os.environ.get("E2E_BASE", "https://board.test").rstrip("/")
LIVE = BOARD != "https://board.test"
TYPES = {".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json"}
CLEAN = {"/": "index.html", "/setup": "setup.html", "/practice": "practice.html", "/replay": "replay.html"}
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
        return r.fulfill(status=200, content_type="text/html", body=MOCK)
    return r.abort()


def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


def board_state(pg):
    return pg.evaluate("""() => ({
      mode: document.getElementById('mode').textContent,
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
    check(not summary and f"reading {roster[0]} + {roster[1]} players" in dock,
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
    pinned = board.evaluate(f"(() => {{ const c = document.querySelector(\".q-away .pcard[data-key='{pin_key}']\"); return c ? [c.classList.contains('is-held'), c.querySelector('.held') ? c.querySelector('.held').textContent : ''] : null; }})()")
    check(bool(pinned and pinned[0] and pinned[1].startswith("Pinned")), f"pinned card stays on the board ({pin_key}: {pinned})")
    counts = board.evaluate("['home', 'away'].map(s => [document.querySelectorAll('.q-' + s + ' .pcard').length, document.querySelectorAll('.tcol.side-' + s + ' .tcard').length])")
    check(counts == [[3, 2], [3, 2]], f"each side shows 3 player cards and 2 team cards ({counts})")
    print("   greyed cards:", board.evaluate("document.querySelectorAll('.pcard.is-dim, .tcard.is-dim').length"))
    board.click(f".q-away .pcard[data-key='{pin_key}'] button[data-act=hold]")
    board.wait_for_timeout(200)
    check(board.evaluate("document.querySelectorAll('.pcard.is-held').length") == 0, "Unpin releases the card")
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

    board.close()
    check(not errors, "no page errors" + ("" if not errors else ": " + " | ".join(errors[:5])))
    b.close()

print(f"\n{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED'}")
