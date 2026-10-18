# Stat Pop Board: full project context

**As of:** 2026-10-17, v0.3.0. **Written by:** the Claude session that built v0.1–v0.2.1, Oct 3–17.

This is the long-form record of what was asked for, what was decided, why, and what's still unknown. `CLAUDE.md` holds the working rules and how-to, and `docs/HANDOFF.md` holds the short status and backlog. Read those first; read this file when you need the reasoning behind a choice, or before reopening a decision.

---

## 1. TL;DR

- **Status.**
  - The site is live at https://stat-pop-board.vercel.app: the board, `/setup`, `/practice` and `/replay`.
  - The full pipeline works end to end in automated browser tests: reader in the stats tab, then `postMessage`, then engine, then board. The tests ran against a stand-in StatBroadcast page and, separately, against the real production files.
  - **The reader has never run on a real StatBroadcast page.** The first real match (tonight, Oct 17, 7:00 pm MT) is the calibration run.
- **Hard rule.** Nothing ever fetches StatBroadcast from a server or script. The reader runs only inside William's own open tab. The reasons are their terms and their bot protection.
- **Starting the reader.** Three ways: a bookmark (no install), a console paste (works even when the page blocks outside scripts), or Tampermonkey (hands-free; one-click install as of v0.2.1).
- **First job for the next agent.** Get the "Reader check → Copy for Claude" JSON from a real StatBroadcast page and fix parsing against it.

---

## 2. The user and the job

- **Who.** William Fischer runs the graphics computer for Montana PBS broadcasts of Montana State (MSU) volleyball, basketball and football.
- **The workflow today.** He watches the public StatBroadcast page for the match and builds short on-air stat graphics ("pops") by hand. In the graphics software: roster dropdown, then player, then the pop name (e.g. "Attacks & Blocks"), then he types the values. He also types team pops himself, like "4-0 Scoring Run", "Team Hit% 0.327" or "28 Team Blocks".
- **The goal.** A second-monitor board that does the scanning for him. It finds the few players and stats actually worth popping right now, hides the unimpressive ones ("1 block", "2 kills"), and pre-formats them the way he types them.
- **Constraints he stated.**
  - Personal and non-commercial. A separate company operates the stats; Montana PBS isn't involved in this tool.
  - The 5–10 s public delay is acceptable.
  - It does not connect to the graphics software, which runs on a different computer.
  - The stats page and the board run side by side on the same computer, at work.
  - Installing browser extensions such as Tampermonkey on the work computer may not be allowed.
- **Season.** Volleyball now. Basketball starts in November; football comes later.

---

## 3. Requirements, as asked for, and where each stands

| # | Requirement (William's framing) | Asked | Status |
|---|---|---|---|
| 1 | Research StatBroadcast and how it displays live stats | Oct 3 | Done (§4) |
| 2 | Read the specific public StatBroadcast page live, with no login and no proprietary connection, as anyone sees it | Oct 10 | Built; real page unverified |
| 3 | Surface only notable stats for the most active players; hide "1 block"-type stats | Oct 10 | Done: notability scales with sets played (§6.6) |
| 4 | Impact/star players and hit % | Oct 10 | Done |
| 5 | Player pop subtypes and combos: "Attacks and Blocks", "Digs and Blocks", "Attacks and Digs"; 2–3 options per player | Oct 10 | Done: up to 3 pops per card |
| 6 | Layout: console/last play top-left; team pops top-right (2 columns of 2); 3 home cards bottom-left; 3 away cards bottom-right | Oct 10 | Done |
| 7 | Read console keywords: a player named in the last play gets a card, with that stat on top ("Lauren Greeny block") | Oct 10 | Done: "pin" for 1 rally; real console text format unverified |
| 8 | Cards can be passed or closed ("don't show this player again") | Oct 10 | Done: Pass = 10 rallies; Hide = for this event until shown again |
| 9 | Team stats he types manually; the board suggests them | Oct 10 | Done: team cards |
| 10 | Secondary: rotation tracker; temporary alerts for set point, match point, timeouts, penalties, challenges | Oct 10 | Done: rotation built from serve order; alerts parsed from console text (unverified on the real page) |
| 11 | Move to a Vercel page he can open on the monitor beside the stats page | Oct 17 | Done |
| 12 | Pick impact players from the loaded roster; at least one is always featured; preload the MSU roster; opponent loads pregame | Oct 17 | Done |
| 13 | Each game's StatBroadcast page differs, so it must read a fresh page per game | Oct 17 | Done: paste a link or event ID; per-event engine reset |
| 14 | Both pages on one computer; Tampermonkey may not be allowed; a script should keep the Vercel page live from a user-supplied stats link | Oct 17 | Done: bookmark / console / Tampermonkey starters; board opens the link itself |
| 15 | A repo and handoff for a dedicated agent | Oct 17 | Done: this repo (WilliamFischer02/StatPopperLIVE) |
| 16 | If Tampermonkey is required, the page must walk him through setup; research other ways to get the data | Oct 17 | Not required (§7). Walkthrough rewritten with one-click install (v0.2.1). Alternatives researched (§8) |
| 17 | A Pin on each player card: keeps the card visible and live-updating for about 10 minutes or until unpinned, because cards popped in and out too fast | Oct 17 | Done in v0.3.0 (D14) |
| 18 | Team pops should include team hit %, kills, blocks and the like, not only runs | Oct 17 | Done in v0.3.0: filler team cards (D14) |
| 19 | Always 2–3 player cards and 2–3 options per card per side, and 1–2 team cards per side, even if minor; minor ones greyed until they reach a baseline | Oct 17 | Done in v0.3.0: 3 player cards, 2+ options, 2 team cards, greyed filler (D14) |

---

## 4. What we know about StatBroadcast

- **What it is.**
  - A live-stats viewer. The scorer's software at the venue (StatCrew, or NCAA LiveStats) uploads to StatBroadcast through their "Broadcastr" client.
  - The public page shows box score, play-by-play and other views of that data.
  - Support docs: [StatBroadcast Broadcastr setup](https://www.statbroadcast.com/support/broadcastr.php) and [StatCrew live feed setup (PDF)](https://www.statbroadcast.com/support/pdf/Setup-BroadcastrStepByStep.pdf).
- **URLs.**
  - Event page: `https://stats.statbroadcast.com/broadcast/?id=<eventId>`.
  - MSU's StatMonitr game list uses `gid=mtsu`.
  - William reaches the page from msubobcats.com → Schedule → the game's "Stats" link.
- **Event IDs seen.**
  - `670272`: EWU at MSU, Oct 3. That match was live during the first research session.
  - `670274`: tonight's home match (Southern Utah, Oct 17, 7:00 pm MT), from earlier research. **Confirm on msubobcats.com.**
- **Public delay:** about 5–10 s.
- **Terms:** "Access to StatBroadcast services is granted only for personal, non-commercial use through the standard StatBroadcast web interface."
- **Bot detection.** Automated fetches of the page fail. This was seen again on Oct 17: a plain fetch of the event page errored. Treat this as a wall to respect, not a puzzle to solve.
- **There is a terms prompt.** "Accept & Continue" must be clicked before the stats render. The reader waits and shows a message until then.

**Seen on the live page (Oct 17, SUU at MSU, event 670274).**

- The player box heads its columns `S # PLAYER K E TA HIT% AS SA DG BL`, so blocks come as one combined `BL` count (v0.3.1). It has a TEAM row.
- The tab title gets a `[Paused]` prefix when StatBroadcast stops refreshing (v0.3.4).
- There are team-by-set tables with volleyball columns, and their rows ("Set 1", "Set 2", "Match") were read as players until v0.3.5. William reported this. The exact layout wasn't captured, so the mock's version is a guess.
- A TEAM COMPARISON table (ATK, SACE, BLKS) doesn't qualify as a box score.

**Assumed before Oct 17.** These assumptions came from StatCrew conventions and indirect research. The title format and table reading now work on the live page; the rest is still unconfirmed.

- The tab title carries the score as `"UI 18, MSU 24 - SET 3"` (visitor first), and `"... - FINAL"` when the match ends.
- The box score is ordinary HTML `<table>`s in the top-level document, not inside an iframe, with StatCrew column headers (`#`, `Player`, `K`, `E`, `TA`, `PCT`, `A`, `SA`, `SE`, `RE`, `DIG`, `BS`, `BA`, `BE`) and a `Totals` row.
- A team's table can be told apart by a nearby heading or caption containing the team name or code.
- The line score is a small table whose header row reads `1 2 3 (4 5)`.
- Play-by-play/console sentences look like StatCrew: `[Server] Kill by Last, First (from Setter).` The engine also accepts plain English: "Lauren Greeny serves an ace".
- The page sends no strict Content-Security-Policy and no `Cross-Origin-Opener-Policy`. Both have fallbacks if it does (§7).

---

## 5. Decision log

Each entry gives the decision, the reasoning, and the alternatives rejected. Don't reopen these without William.

**D1. Read the visible page, not a data feed (Oct 10, William's call).** The first plan (Oct 3) leaned on the StatCrew-format XML behind StatBroadcast. William redirected: the tool should read the public page he already has open, the way he does by eye.

**D2. No server-side access to StatBroadcast (Oct 10 and 17).** A server or script fetching StatBroadcast breaks their terms ("through the standard web interface") and runs into their bot detection. Getting around bot protection isn't something to build. Rejected:
- a Vercel serverless poller or proxy
- a headless browser on a server
- a cron job
- any "API" in front of StatBroadcast

The paste-a-link flow gives the same experience, and the data never leaves William's browser.

**D3. The reader runs inside the stats tab and talks to the board through `window.postMessage` (Oct 17).** Browsers isolate sites, so the board can't read another site's tab directly. Code running in the stats tab can read it, and `postMessage` between two windows on the same computer is the standard cross-origin channel. Rejected:
- Embedding StatBroadcast in an iframe on the board: a cross-origin iframe can't be read, and the site may forbid framing anyway.
- `fetch` from the board: blocked by CORS, and against D2.
- `BroadcastChannel` or `localStorage` events: same-origin only.
- A WebSocket relay server: it would need a server, and the data would leave the machine.

**D4. How the reader starts.**
- **Bookmarklet (primary, Oct 17).** No install. One click per page load.
- **Console paste (fallback).** Works even when the page's CSP blocks outside scripts, because code typed into DevTools isn't subject to page CSP. Manual, once per page load.
- **Tampermonkey (optional, hands-free).**
  - The v0.2.0 script injected a `<script src>`, which a strict CSP would also block.
  - **v0.2.1 changed it to `@require`.** Tampermonkey downloads the reader itself, and when CSP blocks page-context injection it falls back to another sandbox ([Tampermonkey sandbox docs](https://www.tampermonkey.net/documentation.php?q=sandbox)).
  - v0.2.1 also adds one-click install (`/stat-pop-board.user.js`) and `@updateURL`/`@downloadURL` for automatic updates.
- **Practice page.** `/practice` auto-loads the reader (unless `?manual=1`), so the whole loop can be tested without a match.
- **Linking works in both directions.** The board opens the stats tab (window name `spb-stats`). Or the reader's dock opens the board (`/?from=stats`, window name `stat-pop-board`). The board pings `hello` every 3 s whenever it has heard nothing for 6 s, which is what relinks after a stats-tab reload.

**D5. Static Vercel site, no backend (Oct 17).** Nothing needs a server. Per-user state lives in `localStorage` on the board origin.

| Key | Origin | What |
|---|---|---|
| `spb:stars:<TEAMKEY>` | board | impact stars; `MSU` for Montana State (kept across matches), otherwise the opponent's code |
| `spb:hidden:<eventId>` | board and stats tab | players hidden for that event |
| `spb:recent` | board | last 5 stats links |
| `spb:swap` | board and stats tab | swap sides |
| `spb:mode` | stats tab | `here` = reopen the in-tab board automatically |
| `spb:replay-stars:<TEAMKEY>` | board | stars on the `/replay` demo |

**D6. Engine design (Oct 10, tuned on the Oct 1 replay).**
- **Pure and DOM-free,** so it runs in Node tests and in a shadow root.
- **Notability scales with effective sets played** (`vbEffSets`: completed sets plus the fraction of the current set, minimum 0.75). Per-stat "par per set" and minimums:

  | Stat | Par / set | Minimum (set 1 → later) |
  |---|---|---|
  | Kills | 3.2 | 4 → 5 |
  | Digs | 3.2 | 5 → 6 |
  | Assists | 9.5 | 10 → 12 |
  | Blocks (solo + ½ assists) | 0.9 | 2 → 3 |
  | Aces | 0.45 | 2 |
  | Points | 3.8 | 8 |

  Hit % counts only with ≥ 8–10 attempts, ≥ 4 kills and ≥ .250, with a bonus for zero errors.
- **Pops are the graphics software's button names:** Attacks, Kills, Blocks, Digs, Assists, Aces, Points, plus the combos Attacks & Blocks, Attacks & Digs, Digs & Blocks and Assists & Digs. A combo scores as the geometric mean of its parts plus a small bonus. A pop needs a score of 0.8 or more to show, with up to 3 per card. A pop that is covered by a stronger pop using the same stats is dropped.
- **Impact score.** Impact = best pop + 0.35 × second pop + 0.2 × recent involvement (last 12 rallies). Boosts:
  - +100 when pinned (the last play named the player)
  - +1.2 for a serving streak of 3 or more
  - +0.35 for a starred player
  - +0.3 for already being on the board, for stability
- **Who gets a card.** A player qualifies if pinned, on a serving streak, or with a best pop ≥ 0.85.
- **Cards per side.** 3 player cards and 2 team cards. Returning players keep their slot.
- **Impact stars.** Each team with any starred player always shows at least one. If needed, the starred player replaces the last non-pinned card.
- **Team cards.**
  - Active run of 3-0 or more, or an extended run such as 7-2.
  - Longest run this set.
  - Set and team hit %, team kills, blocks, aces, digs, service errors.
  - A set summary for 3 rallies after a set ends.
- **Alerts.**
  - Set point and match point (25, or 15 in set 5, win by 2).
  - Timeout, challenge, penalty and substitution, from console text.
  - Set won, and final.
- **Rotation.** Built from the order of servers. P1 is the server's spot. Liberos aren't tracked.

**D7. Impact players (Oct 17).**
- **Where the roster comes from.** The MSU 2026 roster (16 players, from msubobcats.com) is bundled, so MSU stars can be picked before the stats page lists anyone. The opponent's roster appears once their page lists it.
- **Matching rule.** A star matches a player with the same normalized last name plus the same number or the same first initial. A star with no last name matches on number alone. This survives a jersey-number typo or a missing first name.

**D8. Fresh page per game (Oct 17).**
- **Event changes.** `eventId` (the URL `id`) changes reset the engine.
- **Reloads.** A new reader instance after a reload marks only its newest play line as live, so the board doesn't replay old plays.
- **Play-line capture.**
  - A `MutationObserver` collects changed text that names a rostered player and contains an action word (kill, ace, block…), or that contains an alert word (timeout, challenge…).
  - A batch of 3 or fewer lines counts as new plays, repeats allowed, because back-to-back aces read the same.
  - A bigger batch means the page redrew its list, so only lines never seen before count.
  - The same text within 3 s is dropped as a duplicate.

**D9. Look and layout.**
- The board is dark by design, for a dim truck or press row.
- Fonts: Barlow Condensed for display, Barlow for body, IBM Plex Mono for numbers.
- Colors: home blue `#4f8ff0`, away gold `#cdb57a`, tally red `#ff4b3e` for live, impact gold `#f2c94c`.
- Status modes in the header: Waiting, Linked, Live, Stale (more than 20 s silent).
- The document title shows the score, so it reads from the taskbar.

**D10. Build and repo shape.**
- The site is a readable, unminified build, about 150 KB.
- `site/` is committed and Vercel serves it with no build step (`vercel.json` is generated by the build).
- `python3 tools/build_site.py --check` catches a stale `site/`.
- Minification was tried and dropped: it made deploys harder to verify by checksum, and size doesn't matter here.

**D11. Practice and replay data.**
- **Source.** A hand transcription of MSU 3–0 Idaho (Oct 1) play-by-play from msubobcats.com box score 7757.
- **What's exact:** kills, errors, aces, blocks, assists and reception errors.
- **What's estimated:**
  - Attempts are spread across each set to match the box score's per-set totals.
  - Digs are spread evenly, since play-by-play doesn't record them.
- `tools/build_replay.py` checks the transcription against the final box score (0 mismatches).

**D12. Tests.**
- `test/replay.test.js` runs the engine through the whole Oct 1 match.
- `test/e2e_site.py` runs 22 Playwright checks: linking both ways, reload recovery, stars, practice page, setup page, the Tampermonkey script, the reader starting without a script URL, and the outdated-reader warning.
- The e2e test can run against the live site with `E2E_BASE=...`. It never contacts StatBroadcast; a local mock stands in.

**D13. v0.2.1 hardening (Oct 17 afternoon).** William asked to make sure the page walks him through Tampermonkey if it's needed. Changes:
- One-click install link, with `@require` and auto-update.
- Setup steps for current browsers. Chrome 138+ needs the extension's **Allow User Scripts** switch; older Chrome and Edge need **Developer mode** ([Tampermonkey FAQ Q209](https://www.tampermonkey.net/faq.php?q=Q209), [Chrome userScripts docs](https://developer.chrome.com/docs/extensions/reference/userScripts)).
- An "IT blocked it" exit to the bookmark.
- A pre-game test against a finished real match.
- The reader falls back to the production origin when nothing tells it where the board is, which is the Tampermonkey `@require` case.
- The board warns when the stats tab runs an older reader than the board.

**D14. v0.3.0: Pin, full board, greyed filler (Oct 17, about 3 pm).** William tried the practice page and asked for three things. How each was read and built:
- **Pin.** A Pin/Unpin button on every player card. The card stays on its side, still updating, for 10 minutes or until Unpin, and shows "Pinned · until 7:42". Pin-held cards take slots first; max 3 per side (a 4th releases the oldest). Pass and Hide release a pin. Pins aren't saved across a stats-tab event change or a Swap sides.
- **Always-full sides.** "2–3 stat option cards for 2–3 players per side" was read as both 3 player cards per side and at least 2 options per card (the Oct 10 ask was 2–3 options per player). Cards fill only from players with a recorded stat, so a side can be short in the first rallies. Team cards: 2 per side from filler lines (hit %, kills, blocks, digs, aces, set hit %), 1 in the first rallies.
- **Greyed until notable.** Filler cards and options use the existing notability bars as the baseline: an option is greyed below pop score 0.8; a card is greyed unless it qualifies on its own (best pop ≥ 0.85, last play, or a serving streak) or is pinned. Starred players' cards can be greyed too.
- **Less flicker.** New cards get a +1.5 stickiness bonus for 4 rallies, and a card that stops being notable stays as greyed filler instead of vanishing. Idaho replay: cards gone within 2 rallies of arriving went from 56 to 24.

---

## 6. Architecture quick reference

The full version is in `CLAUDE.md`. Summary:

```
StatBroadcast tab (William's browser)                    Board window (stat-pop-board.vercel.app)
  spb.js reader ── state {snap, lines, diag} ──────────▶  live.js → PopEngine.update → BoardView
               ◀── ack / hello ───────────────────────────
```

- **Reader to board:** `{spb:1, type:'state', v, inst, eventId, seq, sentAt, ok, kind, error, snap, lines(last 12), diag}`. Sent on any page change (250 ms debounce), and at least every 2 s.
- **Board to reader:** `{spb:1, type:'ack', seq}`, plus `{spb:1, type:'hello'}`.
- **Origin checks.** The reader accepts only messages from the board origin. The board accepts its own origin and `https://*.statbroadcast.com`.
- **Snapshot contract:** `{sport, status, set, score{home,away}, setsWon{home,away}, teams{home,away:{code,name,players[],totals}}}`.
- **Diagnostics.** `diag` carries the version, eventId, URL, raw tab title, parsed title, team names, tables found (side, player count, headers, nearby context) and lines captured. This is what "Copy for Claude" exports.

---

## 7. Will it update live? Honest answer

**The mechanism is live.**
- The reader reacts to every change on the stats page: a `MutationObserver` with a 250 ms debounce, plus a 2 s safety tick.
- The board redraws on every message.
- End-to-end latency is StatBroadcast's own 5–10 s public delay plus well under 3 s.
- This is proven in browser tests against the production files.

**What isn't proven is reading the real page.** Every way it could fail shows up on the board or in Reader check, and each has a fallback:

| What you see | Likely cause | What to do now | Fix for the agent |
|---|---|---|---|
| Bookmark shows "this page blocked the reader" | Page CSP blocks outside scripts | Use the console paste, or Tampermonkey (`@require` is not blocked the same way) | Consider the self-contained bookmark (§8 #4) |
| Dock says "pop-up blocked" | Browser pop-up setting | Allow pop-ups for statbroadcast.com, or open the board first and paste the link there | None |
| Board stays "Waiting"; dock says the page blocked the board link | `Cross-Origin-Opener-Policy` on StatBroadcast severs the window link | Use **Show here** on the dock: the full board inside the stats tab | Known limitation; the in-tab board is the answer |
| Linked, but "Waiting for the score in the tab title" | Title format differs from the assumption | Copy for Claude | Fix `parseTitle`, or read the score from the page |
| Linked, but "Waiting for both teams' box-score tables" | Not on the box-score view; tables in an iframe; or different headers | Switch the stats page to Box Score, then Copy for Claude | Map the real headers; read same-origin iframes if needed (remove `@noframes` or walk `frames[]`) |
| Cards show, but plays never pin or alerts never fire | Play-by-play text or format differs | Copy for Claude, after a few rallies | Adjust `playLike`, `lineFrom` and `parsePlay` against real lines |
| Teams on the wrong side | Side detection guessed wrong | **Swap sides** | Fix side detection in `readTables` |

**Pre-game test William can run any time, on a finished match:**
1. Open the board and paste a finished match's link or ID, e.g. `670272` (Oct 3).
2. Accept & Continue, then click the bookmark.
3. Open **Reader check**. It should show "Reading OK", both teams' tables with player counts, and the final score from the title.
4. Click **Copy for Claude** and paste the result into a session either way. Even "it works" JSON is valuable as a test fixture.

Play capture can only be tested during a live match.

**Is Tampermonkey required? No.**
- The bookmark needs no install.
- The console paste works even if the page blocks outside scripts.
- Tampermonkey is only the hands-free option.
- If the work computer blocks extensions, nothing is lost.

---

## 8. Other ways to get the live data (researched Oct 17)

| # | Method | Install? | Survives a strict page CSP? | Live? | Verdict |
|---|---|---|---|---|---|
| 1 | Bookmarklet that loads `spb.js` (current) | No | No: the loaded script can be blocked | Yes | **Primary** |
| 2 | Console paste of the full reader (current) | No | Yes | Yes | **Fallback** |
| 3 | Tampermonkey with `@require` (v0.2.1) | Extension + a browser switch | Yes, via its sandbox fallback | Yes; starts by itself | **Hands-free option** |
| 4 | Self-contained bookmark: the whole reader inside the `javascript:` URL | No | Likely; browsers generally exempt bookmarklet code itself from page CSP | Yes | **Build if #1 is blocked on the real page.** Updates mean re-dragging the bookmark; the board's version warning covers that |
| 5 | Our own unpacked Chrome extension (content script) | Developer mode + "Load unpacked" | Yes | Yes | Only if Tampermonkey is banned but Developer mode isn't |
| 6 | Reader listens to the page's own data responses (wrap `XMLHttpRequest`/`fetch` inside the tab) | Same as the starter used | Same as the starter | Yes; more structured than DOM scraping | **Most promising upgrade** once the real page is seen. It reads only what the official page already downloaded and adds no requests. Needs care so it never changes the page's behavior |
| 7 | Board captures the stats tab (`getDisplayMedia`) and runs OCR (e.g. Tesseract.js) | No | Yes; also immune to COOP | Yes, but heavy and error-prone | Last resort only |
| 8 | Manual copy and paste: select all on the stats page, paste into the board | No | Yes | No; refreshes only on each paste | Emergency fallback; cheap to add |
| 9 | Sanctioned feed: ask MSU athletics (the SID) or StatBroadcast for the StatCrew live XML that broadcast graphics commonly ingest | No | n/a | Yes; the most reliable | The proper automated route, but it needs permission. William chose the visible-page approach (D1); still worth raising if this becomes a crew tool |
| 10 | Server-side scraping or polling of StatBroadcast | n/a | n/a | n/a | **Rejected** (D2) |

**Recommended order:**
1. Verify #1 and #2 on the real page.
2. If #1 is blocked, build #4.
3. After seeing the page's network traffic in DevTools, consider #6.
4. Raise #9 with William only for crew-wide use.

---

## 9. Deployment and infrastructure history

- **Vercel.**
  - Team `williamfischer02's projects` (`team_MltQetJhTSO55JZan09NjIls`, hobby plan).
  - Project `stat-pop-board` (`prj_x9jOMIj5VOQH8fsIUGvIDH3QfVtq`). Production alias `stat-pop-board.vercel.app`.
  - Vercel Authentication is off: previews are public.
- **v0.2.0 (Oct 17, about 11:15 MT).**
  - Deployed through the Vercel API before any repo existed.
  - The Claude connector first lacked permission to create projects; William reconnected it.
  - Inline uploads had to be small, so `spb.js` went up in three parts, joined by a one-off build command (`dist/`). The project's saved build settings still reflect that, and the repo's `vercel.json` overrides them.
  - **Upload quirk:** a literal `̀` in source was decoded on upload. That's why `normName` in `engine.js` uses literal combining characters. It's harmless now that deploys come from Git.
  - Every file was verified byte for byte against the build. The live e2e test passed.
- **Repo.** `WilliamFischer02/StatPopperLIVE`, populated Oct 17 with this tree; it's the source of truth from now on.
- **v0.2.1 (Oct 17, about 14:55).**
  - Deployed from the repo's `main` through the Vercel API (`gitSource`), so Vercel built it from the repo using `vercel.json`.
  - **The project is still not linked to the repo.** Pushes don't deploy until William connects it in the Vercel project's Git settings. Until then, deploy with the Vercel CLI (`npx vercel --prod`, after `vercel login`), or ask him.
- **Earlier artifacts.** These are private to William, kept for reference only.
  - [Design doc](https://claude.ai/code/artifact/27fedf26-d98e-4345-8a80-c25222160397).
  - [Single-file replay](https://claude.ai/artifact/Ve3pV6h1UXWztMPYPfbiqi).
  - A v0.1 standalone Tampermonkey overlay (not in the repo).

---

## 10. Verification log

| When (MT) | What | Result |
|---|---|---|
| Oct 10 | Engine replay of the Oct 1 match (Node) | Sensible cards throughout; slowest update about 10–18 ms |
| Oct 17, about 11:20 | Production files vs local build (sha1, every file) | Identical |
| Oct 17, about 11:25 | e2e (17 checks) against the production files | All passed |
| Oct 17, about 11:40 | Repo zip: unzip, then `--check`, Node replay, e2e | All passed |
| Oct 17, about 14:40 | v0.2.1 e2e (22 checks), local | All passed |
| Oct 17, about 14:55 | v0.2.1 deployed from GitHub (commit `d177ba7`, deployment `dpl_EQ1uGfryhPzMp8xjY3FVPtCkU4ix`): all 13 live files byte-identical to the repo build; live e2e, 23 checks including a Tampermonkey-style start linking to the live board | All passed |
| Oct 17, about 2:50 | v0.3.0 local: replay test with board-rule assertions; e2e 25 checks on Windows; CI on Linux | All passed |
| Oct 17, about 3:00 | v0.3.0 preview (`dpl_AfCwpWwEcfwnDy4BgvBeBTQ7DMZd`) e2e 25 checks; production (`dpl_4apAsiymyoBRyuBsxA9sD2phgjjA`, `main` `d143a8d`): 13 live files byte-identical, live e2e 26 checks | All passed |
| Oct 17, 7:00 pm | Reader on the real StatBroadcast page, SUU at MSU (670274), the whole match | Worked after v0.3.1. Set and match rows appeared as player cards (fixed in v0.3.5). No Copy for Claude JSON saved yet |
| Oct 17, about 11:30 pm | v0.3.5 local: mock with the live headers, TEAM row and team-by-set tables. Before the fix it reproduced the bug (cards "1", "2", "3", "Match"; dock 17 + 15 players). After the fix: 14 + 13 players; replay test and e2e (26 checks) | All passed |

---

## 11. Open questions for William

- [ ] Does the work computer allow Chrome extensions? (Decides whether Tampermonkey is an option.)
- [ ] Do the pop names on the board match the graphics software's buttons exactly? ("Attacks & Blocks" vs "Attacks and Blocks", etc.)
- [ ] Which StatBroadcast view does he keep open during a match: Box Score, Play-by-Play, or a combined view? The reader needs the box-score tables visible.
- [ ] For basketball: which pops does he build most (points, rebounds, 3PT, FG%, double-doubles, runs)?
- [ ] Does the team-pop wording match how he types it? The board follows his examples: "4-0 Scoring Run", "Team Hit% 0.327", "28 Team Blocks".

---

## 12. Backlog with acceptance criteria

1. **Calibrate against the real page.**
   - Done when a real "Copy for Claude" JSON is a test fixture, Reader check shows "Reading OK" with correct player counts on a live match, and scores and sets match the page.
2. **Self-contained bookmark (§8 #4)**, only if the normal bookmark is blocked.
   - Done when `/setup` offers it, its size works in Chrome and Edge, and the board's version warning tells him when to re-drag it.
3. **Read the page's own data responses (§8 #6)**, if the real page loads structured data.
   - Done when the reader prefers that data, falls back to the DOM, adds zero requests, and passes every existing check.
4. **Wording tweaks** to pop and team-pop labels, after he answers §11.
5. **Basketball.**
   - Snapshot contract, reader header map, pops, team cards (runs, FG%, rebounds margin) and alerts (fouls, timeouts).
   - Replay data from a real game for tests.
6. **Opponent roster positions pregame** (paste or roster import).
7. **Football.**
8. **Upkeep.** Roster updates each season; dependency-free stays the rule.
