# Stat Pop Board

A second-monitor board for live sports graphics. It reads the public StatBroadcast stats page you already have open, then suggests the few stats worth putting on air right now, pre-formatted as pops.

**Live:** https://stat-pop-board.vercel.app

## Game night

1. Open the [board](https://stat-pop-board.vercel.app). Paste the game's StatBroadcast link, or just its event number, and click **Open stats page**.
2. On the stats page, click **Accept & Continue**, then click your **Pop board** bookmark. If you don't have the bookmark yet, see [Setup](https://stat-pop-board.vercel.app/setup).
3. Put the stats page on one monitor and the board on the other.
4. **★ Impact players**: star the players you build graphics for most. Each starred team always keeps at least one starred player on the board, and MSU picks carry over to every match.
5. If something looks wrong, click **Reader check → Copy for Claude** and paste the result into a Claude session.

To try everything without a live game, click **Try the practice page** on the board.

## How it works

A small reader runs inside the stats tab. You start it with the bookmark, a console paste or Tampermonkey. It reads the score, the box score and new play-by-play lines from that page, and passes them to the board window on the same computer. Nothing goes to a server, and the reader never requests StatBroadcast itself.

## Development

```bash
python3 tools/build_site.py           # rebuild site/ (commit it)
python3 tools/build_site.py --check   # verify site/ is current
node test/replay.test.js              # engine replay of MSU vs Idaho, Oct 1
python3 test/e2e_site.py              # browser end-to-end test (needs: pip install playwright && python -m playwright install chromium)
```

Vercel serves `site/` as-is. See `CLAUDE.md` for the architecture and rules, and `docs/HANDOFF.md` for current status.

Personal, non-commercial tool. Not affiliated with StatBroadcast, Montana State or Montana PBS.
