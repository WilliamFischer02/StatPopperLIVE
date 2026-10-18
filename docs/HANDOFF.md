# Handoff: status as of 2026-10-17, after the first live match (v0.3.5)

## TL;DR

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
| Oct 17 (evening) | First live match. Jarvis Prime (William's monitoring agent) shipped v0.3.1 (read the live headers `S # PLAYER K E TA HIT% AS SA DG BL`), v0.3.2 (greyed pre-match preview), v0.3.3 (team colours) and v0.3.4 (StatBroadcast's `[Paused]` title). After the match William reported set and match stats among the player cards, which he had to Hide and Pass repeatedly. v0.3.5: the reader reads only tables with a `#` or `PLAYER` column, takes the jersey only from the `#` cell, and skips team, totals, set and match rows. The mock now uses the live headers, a TEAM row and a team-by-set table, and the e2e test checks for it (26 checks). |

## Decisions (don't reopen without William)

- **No server-side StatBroadcast access.** See the hard rules in `CLAUDE.md`. The paste-a-link flow gives the same experience without breaking them.
- **The reader runs in the user's tab and hands off to the board with `postMessage`.** Both windows must be on the same computer.
- **The bookmarklet is the main way to start the reader** on the work computer. Console paste and Tampermonkey are fallbacks.
- **Volleyball first.** Basketball and football come later.
- **Full board with greyed filler (v0.3.0, William's call).** Each side always shows 3 player cards and 2 team cards, even when a stat is minor; minor ones are greyed rather than hidden. This replaces the Oct 10 "never show 1 block" rule.
- **Dark board, typed-pop wording.** Pop names match William's graphics software buttons, and he types team stats ("4-0 Scoring Run", "Team Hit% 0.327", "28 Team Blocks") himself, using the board's team cards as suggestions.

## Unverified and at risk

- [ ] **Real page structure: mostly confirmed Oct 17, no fixture yet.** The tab title and the box score read correctly on the live page (box score after v0.3.1). The team-by-set table's exact layout was never captured: the v0.3.5 fix rejects it by structure (no `#` or `PLAYER` column) and by label, and the mock's version is a guess. Next match: Reader check → Copy for Claude, check `ignoredTables` and `tables[].skipped`, and save the JSON under `test/`.
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

- **Current production deployment:** `dpl_4apAsiymyoBRyuBsxA9sD2phgjjA` (v0.3.0, built from `main` at `d143a8d`, PR #1), aliased to `stat-pop-board.vercel.app`. Deployed about 3:00 pm MT Oct 17; all 13 live files byte-identical to the build; live e2e 26/26. Previous: `dpl_EQ1uGfryhPzMp8xjY3FVPtCkU4ix` (v0.2.1), a one-click rollback candidate.
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
