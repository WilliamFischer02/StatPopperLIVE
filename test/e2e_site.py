"""End-to-end: board <-> stats tab linking, reload recovery, practice page, impact picks, setup + replay pages.

Local build (default):  python3 test/e2e_site.py
Live site smoke test:   E2E_BASE=https://stat-pop-board.vercel.app python3 test/e2e_site.py
In live mode the board's files are downloaded from the real site (TLS verified, proxy/CA from the
environment) and served to the test browser under the real origin. StatBroadcast is always the
local mock page; the test never contacts StatBroadcast.
"""
import os
import ssl
import sys
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "test"
MOCK = (ROOT / "test" / "mock-statbroadcast.html").read_text()
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
    for n in range(start + 1, start + 6):
        stats.evaluate(f"showRally({n})")
        stats.wait_for_timeout(350)
    board.wait_for_timeout(700)
    s3 = board_state(board)
    print("  ", s3)
    check(any(x.startswith("*") for x in s3["home"]), "star rule holds as the set goes on")
    check(any("Run" in t for t in s3["team"]), "team scoring-run card shows during MSU's run")
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
    check("@match        https://stats.statbroadcast.com/broadcast/*" in tm and BOARD in tm, "setup page builds the Tampermonkey script")
    st.screenshot(path=str(SHOTS / "e2e-setup.png"), full_page=True)
    rpg = ctx.new_page()
    rpg.goto(BOARD + "/replay")
    rpg.wait_for_timeout(500)
    check(rpg.evaluate("document.querySelectorAll('.pcard').length") >= 5, "replay page renders player cards")

    board.close()
    check(not errors, "no page errors" + ("" if not errors else ": " + " | ".join(errors[:5])))
    b.close()

print(f"\n{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED'}")
