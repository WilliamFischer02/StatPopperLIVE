# Handoff: status as of 2026-11-15 (v0.5.1)

## TL;DR

- **v0.5.0 (Nov 15): basketball.** William has a basketball broadcast today and asked for full basketball support with the sport detected automatically. Built: `src/basketball.js` (pops, runs, fouls and bonus, hot hand, alerts, leaders), a sport switch in the engine, basketball box and title reading in the reader, per-sport list stats and stars, `/practice-bb`, a basketball mock and tests (Node basketball test; e2e is 54 checks). Volleyball replay output is byte-identical to v0.4.1.
- **v0.5.1 (Nov 15, game-day check).** CI on the v0.5.0 PR failed twice. One cause was real: if the reader's readings jumped across a period break (seen at tip-off, next seen mid-second-half), the engine took the stale reading as the end of the period, so whole-game team fouls were shown as this half's and a bonus could be claimed wrongly. `track` in `basketball.js` now treats a period change that arrives with a jump (more than one period, more than 8 combined points, or more than 3 combined fouls) as unseen: fouls fall back to whole-game `pf`, no bonus, no period summary. The other was a Playwright 1.47 `wait_for_url` miss in the e2e test (replaced with `wait_for_function`).
- **Basketball has never run on a real StatBroadcast page.** The box-score headers, the tab title's wording and the play-by-play wording are all guesses with fallbacks. **First job after the Nov 15 game: get Reader check → Copy for Claude from the real basketball page** (it now includes `pageTables`, the first rows of every table) and fit `bbKey`, `parseBBStatus` and `parsePlay` to it. Save it under `test/` as a fixture.

- **v0.4.1 (Nov 7, 2 pm).** The in-tab "Show here" overlay has the same Cards / Show / Rotate controls; Pass lists the player in the footer with Undo; clicking any pop line or team line copies it. e2e is 38 checks.
- **v0.4.0 (Nov 7, before the 4 pm match).** Card layouts (3 or 5 per team, or every player with two chosen stats and the top 3 highlighted), auto-rotate (Off, 15 s to 10 min) with one-stale-card swaps between rotations, one team card per team with 3–5 lines, an engine-side guard against set/match/team rows, a 100 ms reader debounce, and a polish pass from two UI reviews (glyph mode chips, green Live, quieter buttons, value-tick flash, alert pulse, freshness tint). Replay test and e2e (31 checks) pass; see the verification log in `docs/CONTEXT.md`.

- The site is live at https://stat-pop-board.vercel.app. v0.2.0 went up at about 11:15 MT, v0.2.1 (Tampermonkey hardening) that afternoon, and v0.3.0 (Pin button, always-full board with greyed filler) at about 3:00 pm. Each passed the full end-to-end suite.
- Source of truth: the GitHub repo `WilliamFischer02/StatPopperLIVE`. The full decision log and research are in `docs/CONTEXT.md`.
- **First live match done (SUU at MSU, Oct 17, event 670274).** William ran the board on the real page all match and said it "worked wonderfully". Two reader fixes came out of it: v0.3.1 (the live column names AS, DG, BL) and v0.3.5 (team-by-set rows such as "Set 1" and "Match" showed up as player cards). Still missing: a real Copy for Claude JSON saved as a test fixture.
- The site was first deployed through the Vercel API, before this repo existed. Once the repo is connected to the Vercel project, Git pushes take over (see "Deployment notes").

## History

| Date | What happened |
|---|---|
| Oct 3 | Researched StatBroadcast: a viewer for StatCrew-format XML, with a 5–10 s public delay, bot detection, and terms limited to personal use through its web interface. William rejected an XML-feed approach in favor of reading the visible page. |
| Oct 10 | Scope set: surface only notable stats (never "1 block"), with combo pops. Layout: game/console top-left, team pops top-right, 3 home cards bottom-left, 3 away bottom-right. Also: last-play keyword pinning, Pass and Hide, alerts (set/match point, timeout, challenge, penalty) and a rotation tracker. Built the engine, a replay of MSU 3–0 Idaho (Oct 1) and a v0.1 Tampermonkey in-tab overlay. |
| Oct 17 (morning) | Moved to Vercel. Both pages run on one computer, and Tampermonkey may not be allowed on the work machine. Added the board page with paste-a-link (an event ID or URL opens the stats tab), the bookmarklet and console starters, `/setup`, `/practice`, impact-player stars (MSU roster preloaded, MSU stars kept across matches, opponents keyed by team code), a per-event engine reset, and Reader check with "Copy for Claude". Deployed v0.2.0. |
| Oct 17 (afternoon) | v0.2.1: one-click Tampermonkey install that pulls the reader through `@require` and updates itself; setup steps for Chrome 138+ (Allow User Scripts) and older Chrome/Edge (Developer mode); a pre-game test on a finished real match; the board warns about an outdated reader. Repo pushed to StatPopperLIVE. |
| Oct 17 (3 pm) | v0.3.0, PR from `feat/pin-team-stats-fill`. William saw cards pop in and out on the practice page, and team pops that were almost only runs. Added: **Pin** on each player card (10 minutes or until Unpin, still updating); each side always fills 3 player cards and 2 team cards (team hit %, kills, blocks, digs, aces and set hit % as filler); at least 2 options per card; filler cards and options greyed until they reach pop level; a 4-rally stickiness bonus for new cards. On the Idaho replay, cards gone within 2 rallies of arriving fell from 56 to 24. Also: the build and e2e test now run on Windows (LF output, UTF-8 reads, `.gitattributes`). |
| Nov 7 (1–3 pm) | v0.4.0, branch `feat/layouts-rotation`. William asked for 3 / 5 / all-players layouts, a settable auto-rotate that still swaps in a player who just did something, one relevant team card per team, a responsiveness pass and a UI polish pass, all before a 4 pm match. Two review agents (UI copy and layout; UX flow) produced the polish list; the items taken are in the commit message. Deployed to production through the Vercel API (the repo is still not linked). |
| Nov 15 | v0.5.0, branch `feat/basketball`: basketball support and sport auto-detection, built the morning of William's first basketball broadcast. No real basketball page had been seen, so the reader accepts two box layouts and many title wordings, pins from box-score changes rather than only from play lines, and estimates game time from the score when there is no clock. Practice data is a seeded made-up game, not a real one. |
| Oct 17 (evening) | First live match. Jarvis Prime (William's monitoring agent) shipped v0.3.1 (read the live headers `S # PLAYER K E TA HIT% AS SA DG BL`), v0.3.2 (greyed pre-match preview), v0.3.3 (team colours) and v0.3.4 (StatBroadcast's `[Paused]` title). After the match William reported set and match stats among the player cards, which he had to Hide and Pass repeatedly. v0.3.5: the reader reads only tables with a `#` or `PLAYER` column, takes the jersey only from the `#` cell, and skips team, totals, set and match rows. The mock now uses the live headers, a TEAM row and a team-by-set table, and the e2e test checks for it (26 checks). |

## Decisions (don't reopen without William)

- **No server-side StatBroadcast access.** See the hard rules in `CLAUDE.md`. The paste-a-link flow gives the same experience without breaking them.
- **The reader runs in the user's tab and hands off to the board with `postMessage`.** Both windows must be on the same computer.
- **The bookmarklet is the main way to start the reader** on the work computer. Console paste and Tampermonkey are fallbacks.
- **Volleyball first, basketball second (v0.5.0), football later.** The sport is detected from the page, never chosen by hand (William's ask, Nov 15).
- **Full board with greyed filler (v0.3.0, William's call).** Each side always shows its player cards (3 or 5 since v0.4.0) and a team card, even when a stat is minor; minor ones are greyed rather than hidden. This replaces the Oct 10 "never show 1 block" rule.
- **Hold still between rotations (v0.4.0, William's call).** Only the stalest card is swapped out when an off-board player does something notable, one per update; the whole set turns over only on the auto-rotate interval.
- **Dark board, typed-pop wording.** Pop names match William's graphics software buttons, and he types team stats ("4-0 Scoring Run", "Team Hit% 0.327", "28 Team Blocks") himself, using the board's team cards as suggestions.

## Unverified and at risk

- [ ] **Basketball on the real page (everything).** Not seen before Nov 15. In order of how likely each is to need a fix: (1) box-score headers (`bbKey` in `reader.js`); a two-row header with a rowspan would misalign columns; (2) the tab title after the dash (`parseBBStatus`): if the period or clock is not read the board still works, on estimated game time, with no late-game alert, no "over 3:12" on runs and no drought line; (3) play-by-play wording (`parsePlay` in `basketball.js`): if it is not recognised, cards still go live from box-score changes, but dunks and layups are not named and timeouts are not shown; (4) whether the page keeps both teams' boxes in the DOM at once. Reader check shows Sport, period and clock as read.
- [ ] **Basketball pop names** are a first guess (Points, Shooting, 3-Pointers, Free Throws, Rebounds, Assists, Steals, Blocks, Fouls, Points & Rebounds, Points & Assists, Points, Reb & Ast, Rebounds & Blocks, Steals & Blocks). Ask William what his graphics buttons say and how he types team lines ("Team FG% 48.1", "Team 3PT 7-15", "8-0 Scoring Run").
- [ ] **Team fouls and the bonus** are only right when the reader was running from the start of the half or quarter. Otherwise the board says so (`pf`, whole game) and claims no bonus. If the real page shows team fouls, read them instead.
- [ ] **Men's halves vs women's quarters** is taken from the title wording or the line score. If neither says, halves are assumed until a 3rd period is seen.

- [ ] **Real page structure: mostly confirmed Oct 17, no fixture yet.** The tab title and the box score read correctly on the live page (box score after v0.3.1). The team-by-set table's exact layout was never captured: the v0.3.5 fix rejects it by structure (no `#` or `PLAYER` column) and by label, and the mock's version is a guess. Next match: Reader check → Copy for Claude, check `ignoredTables` and `tables[].skipped`, and save the JSON under `test/`.
- [ ] **Window linking on the real site.** If StatBroadcast sends `Cross-Origin-Opener-Policy`, the board-to-stats-tab link breaks. The fallback is the dock's "Show here".
- [ ] **CSP.** If the page's CSP blocks the bookmarklet's `<script src>`, the fallback is the console paste from `/setup`.
- [ ] **Accept & Continue.** The terms prompt must be accepted before the box score renders. The reader waits and shows a message in the meantime.

## Backlog (suggested order)

00. **After the Nov 15 basketball game:** fit the reader to the real page from Copy for Claude; confirm pop names and team-line wording with William; ask whether Pass (25 plays, a few minutes) and the pin rules feel right at basketball speed; read team extras (points in the paint, bench, off turnovers) if the page has them (`teams[side].extra` is already supported by the engine); add an MSU basketball roster to bundle; replace the made-up practice game with a transcribed real one.

0. **Ask William after the Nov 7 match:** which layout and rotate interval he used; whether the copied line format (`GREENY · Attacks & Blocks · 12 K · .350 HIT · 3 BLK`) matches what he types, or should drop the labels; whether the list's two stats should be remembered per sport.

1. **Calibrate the reader with the first real Copy for Claude JSON.** Fix the title, table and console parsing, add a fixture under `test/`, and extend the mock to match.
2. **Opponent roster positions.** Positions are bundled only for MSU. Consider a pregame paste of the opponent roster.
3. ~~Basketball~~ built in v0.5.0; calibration is item 00.
4. **Football.**
5. **Season upkeep.** Update `data/msu-wvb-roster-2026.json` when the roster changes, and add basketball and football rosters.
6. **Optional.** Light mode, or a compact layout for a smaller second monitor.

## Deployment notes

- **Current production deployment:** `dpl_2J3rTAv2eZWg7Z7QRqyg3a1z9mZB` (v0.4.1, built from `main` at `7b2b18e`, PR #5), aliased to `stat-pop-board.vercel.app`. Deployed 1:37 pm MT Nov 7, after William merged the PR himself; all 13 live files byte-identical to the build; live e2e 39/39. Previous: `dpl_CfWWf8F8ZVV6cXacwjR16zcYVuxf` (v0.3.5, the Oct 17 match build), the one-click rollback candidate.
- **How deploys work now:** push a branch, then create the deployment through the Vercel API with `gitSource` (see `CLAUDE.md` → Deploying). Preview deployments add Vercel's toolbar script to `index.html`, so only that file differs from the build there.
- **Push-to-deploy is not on yet.** The Vercel project isn't linked to this repo; William needs to connect it in the project's Git settings. Check with him before assuming a push went live, and verify with the live e2e test.
- **How it was deployed.** This first deploy went through the Vercel API with `spb.js` uploaded in three parts (`parts/spb-1..3.js`), which a one-off build command joined together. As a result, the project's saved settings still contain that build command and a `dist` output directory. The repo's `vercel.json` overrides both: no install, no build, output `site`. You can clear the overrides in the Vercel project settings once Git is connected, but they're harmless.
- **After connecting the repo.** Check that the first Git deployment serves byte-identical files by running `E2E_BASE=<deployment URL> python3 test/e2e_site.py`. The repo's `site/` was verified identical to production on Oct 17.

## Reference

- **Event IDs.**
  - `670272`: EWU at MSU, Oct 3.
  - `670274`: the Oct 17 home match (Southern Utah, 7:00 pm MT, per earlier research). Confirm IDs on msubobcats.com: Schedule → the game's "Stats" link.
- **Earlier write-ups.** These are claude.ai artifacts, private to William, kept for context only. They predate the Vercel site.
  - [Design doc](https://claude.ai/code/artifact/27fedf26-d98e-4345-8a80-c25222160397).
  - [Single-file replay](https://claude.ai/artifact/Ve3pV6h1UXWztMPYPfbiqi), superseded by `/replay`.
- **Not carried into the repo:** the v0.1 standalone Tampermonkey overlay (`stat-pop-board.user.js`) and its build script. `/setup` generates a loader script instead, so updates ship from the site.
