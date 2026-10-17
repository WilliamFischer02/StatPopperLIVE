# Handoff: status as of 2026-10-17 (v0.3.0)

## TL;DR

- The site is live at https://stat-pop-board.vercel.app. v0.2.0 went up at about 11:15 MT, v0.2.1 (Tampermonkey hardening) that afternoon, and v0.3.0 (Pin button, always-full board with greyed filler) at about 3:30 pm. Each passed the full end-to-end suite.
- Source of truth: the GitHub repo `WilliamFischer02/StatPopperLIVE`. The full decision log and research are in `docs/CONTEXT.md`.
- **The main unknown:** the reader has never seen a real StatBroadcast page. Its parsing is based on StatCrew conventions and a mock page. The first real match is the calibration run.
- The site was first deployed through the Vercel API, before this repo existed. Once the repo is connected to the Vercel project, Git pushes take over (see "Deployment notes").

## History

| Date | What happened |
|---|---|
| Oct 3 | Researched StatBroadcast: a viewer for StatCrew-format XML, with a 5–10 s public delay, bot detection, and terms limited to personal use through its web interface. William rejected an XML-feed approach in favor of reading the visible page. |
| Oct 10 | Scope set: surface only notable stats (never "1 block"), with combo pops. Layout: game/console top-left, team pops top-right, 3 home cards bottom-left, 3 away bottom-right. Also: last-play keyword pinning, Pass and Hide, alerts (set/match point, timeout, challenge, penalty) and a rotation tracker. Built the engine, a replay of MSU 3–0 Idaho (Oct 1) and a v0.1 Tampermonkey in-tab overlay. |
| Oct 17 (morning) | Moved to Vercel. Both pages run on one computer, and Tampermonkey may not be allowed on the work machine. Added the board page with paste-a-link (an event ID or URL opens the stats tab), the bookmarklet and console starters, `/setup`, `/practice`, impact-player stars (MSU roster preloaded, MSU stars kept across matches, opponents keyed by team code), a per-event engine reset, and Reader check with "Copy for Claude". Deployed v0.2.0. |
| Oct 17 (afternoon) | v0.2.1: one-click Tampermonkey install that pulls the reader through `@require` and updates itself; setup steps for Chrome 138+ (Allow User Scripts) and older Chrome/Edge (Developer mode); a pre-game test on a finished real match; the board warns about an outdated reader. Repo pushed to StatPopperLIVE. |
| Oct 17 (3 pm) | v0.3.0, PR from `feat/pin-team-stats-fill`. William saw cards pop in and out on the practice page, and team pops that were almost only runs. Added: **Pin** on each player card (10 minutes or until Unpin, still updating); each side always fills 3 player cards and 2 team cards (team hit %, kills, blocks, digs, aces and set hit % as filler); at least 2 options per card; filler cards and options greyed until they reach pop level; a 4-rally stickiness bonus for new cards. On the Idaho replay, cards gone within 2 rallies of arriving fell from 56 to 24. Also: the build and e2e test now run on Windows (LF output, UTF-8 reads, `.gitattributes`). |

## Decisions (don't reopen without William)

- **No server-side StatBroadcast access.** See the hard rules in `CLAUDE.md`. The paste-a-link flow gives the same experience without breaking them.
- **The reader runs in the user's tab and hands off to the board with `postMessage`.** Both windows must be on the same computer.
- **The bookmarklet is the main way to start the reader** on the work computer. Console paste and Tampermonkey are fallbacks.
- **Volleyball first.** Basketball and football come later.
- **Full board with greyed filler (v0.3.0, William's call).** Each side always shows 3 player cards and 2 team cards, even when a stat is minor; minor ones are greyed rather than hidden. This replaces the Oct 10 "never show 1 block" rule.
- **Dark board, typed-pop wording.** Pop names match William's graphics software buttons, and he types team stats ("4-0 Scoring Run", "Team Hit% 0.327", "28 Team Blocks") himself, using the board's team cards as suggestions.

## Unverified and at risk

- [ ] **Real page structure.** The score is assumed to be in the tab title as `"UI 18, MSU 24 - SET 3"` (visitor first). Box-score tables are assumed to use StatCrew headers. The play-by-play/console text is assumed to be StatCrew style (`[Server] Kill by Last, First (from Setter).`) or plain English. All three need confirming with Reader check → Copy for Claude JSON from a live match.
- [ ] **Window linking on the real site.** If StatBroadcast sends `Cross-Origin-Opener-Policy`, the board-to-stats-tab link breaks. The fallback is the dock's "Show here".
- [ ] **CSP.** If the page's CSP blocks the bookmarklet's `<script src>`, the fallback is the console paste from `/setup`.
- [ ] **Accept & Continue.** The terms prompt must be accepted before the box score renders. The reader waits and shows a message in the meantime.

## Backlog (suggested order)

1. **Calibrate the reader with the first real Copy for Claude JSON.** Fix the title, table and console parsing, add a fixture under `test/`, and extend the mock to match.
2. **Opponent roster positions.** Positions are bundled only for MSU. Consider a pregame paste of the opponent roster.
3. **Basketball** (Nov onward). This needs a basketball snapshot contract, reader table mapping (`looksBasketball` already exists), pops (points, rebounds, assists, 3PT, FG%, double-doubles) and runs.
4. **Football.**
5. **Season upkeep.** Update `data/msu-wvb-roster-2026.json` when the roster changes, and add basketball and football rosters.
6. **Optional.** Light mode, or a compact layout for a smaller second monitor.

## Deployment notes

- **Current production deployment:** `dpl_EQ1uGfryhPzMp8xjY3FVPtCkU4ix` (v0.2.1, built from this repo's `main` at `d177ba7`), aliased to `stat-pop-board.vercel.app`.
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
