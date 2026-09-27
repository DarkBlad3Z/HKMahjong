# Hong Kong Mahjong 香港麻雀

Play Hong Kong Mahjong in your browser against three computer players. Scoring follows the
*HK Mahjong Scoring Sheet v1.0* (expanded by V. Nguyen): every win shows its full Fan breakdown and the payments.

**▶ Play:** `https://<your-username>.github.io/<repo-name>/` — or download `index.html` and open it. It runs offline, needs no install, and sends no data anywhere.

## Features

- You vs 3 computer players (Easy / Normal / Hard) — every player's hand is shown at the same size
- Chow, Pong, Kong (exposed, concealed, added), Robbing the Kong, flowers and seasons
- Full scoring: Fan table on each win, 13 Fan limit, points or chips, "full" or "shared" payment
- Hint button that suggests a discard and explains why
- Arrange your hand your way: drag tiles (mouse or touch), **Sort 理牌** button (or the S key), Shift+←/→ to nudge the selected tile
- Highlight matching tiles: point at (or tap) any tile to see every copy on the table
- Display size: Standard, Large or Extra large tiles and text, for easier reading
- Upbeat chiptune music plus sound effects for Chow, Pong, Kong, wins and the start of a game (all synthesised in the browser — Music and Sound can be switched off separately)
- Built-in rules reference, including the booklet's Fan combination tables
- Settings: minimum Fan, game length, optional (†) hands, computer difficulty, display size, tile highlighting, where new tiles go
- Save and resume (stored in your browser's local storage)

## How to play

1. Click **New Game**. You sit at the bottom; East deals.
2. Click a tile in your hand to select it, then click it again (or press **Discard 打**) to discard it. Drag tiles sideways to rearrange them.
3. When you can claim a discard (Chow / Pong / Kong / Win), buttons appear — click one or **Pass**.
4. A hand needs at least **3 Fan** to win (changeable in Settings). Open **Rules 牌例** at any time.

## Rules choices

Where the booklet leaves room for interpretation, the game uses:

- Seven Flowers = 3 Fan and Eight Flowers = 8 Fan, as fixed values
- Concealed Hand counts on a discard win too (Seven Pairs already includes it)
- Optional † hands are on by default, except the † Kong Fan
- If several players can win on one discard, the one nearest the discarder takes it (head bump)
- Blessing of Man only applies if no tile has been claimed yet

## For developers

No dependencies — just Node 18+.

```
node build.js            # bundles src/ into index.html
node tests/run_all.js    # full test suite (add --quick for a shorter run)
```

| Path | Contents |
|---|---|
| `src/core/` | tiles, seeded RNG, hand analysis, scoring, game engine, computer players |
| `src/ui/` | HTML template, styles, SVG tile art, rules text, rendering, controller |
| `tests/` | booklet scoring vectors, unit tests, game simulations, UI tests |
| `docs/` | rules/architecture spec and UI design spec |

`index.html` is a build output — edit files in `src/`, then run `node build.js`.

## Credits

Game code written with AI assistance (Anthropic's Claude models), directed and reviewed by the author.
Scoring rules from the *HK Mahjong Scoring Sheet v1.0*.

## License

[MIT](LICENSE)
