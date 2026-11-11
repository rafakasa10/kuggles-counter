# Chalk: visual identity spec (direction A)

Approved 2026-11-11. Source of truth for colours and the type scale: [`src/ui/theme/chalk.json`](../../src/ui/theme/chalk.json). The numbers behind every rule below are in [chalk-readability.md](chalk-readability.md), produced by `node scripts/readability-check.mjs`. Re-run it whenever a token changes, and don't ship a token change that makes it fail.

## Identity rules

- **Our own everything.** The name is `[APP NAME]` until chosen, and the mark, icon, palette, typography and icon style are all our own. Nothing comes from another app's name, logo, icons, artwork, colours or text, and no third-party asset is loaded. No blue, gold or orange as a brand colour: those are common in existing darts apps, and we want to look different.
- **Mark:** a tally gate (four chalk strokes) crossed by a dart in chalk yellow. A 3-stroke variant is used at favicon size.
- **App icon:** the mark on Slate, with an iOS-style corner radius applied by the system. The light theme uses the same icon.
- **Icon style:** round-capped 2 pt strokes on a 24 pt grid, slightly hand-set angles (±2°), no fills except the active state. Icons are drawn in-house as inline SVG (no icon font, no third-party icon set).
- **No chalk textures or smudges.** The palette and the numbers carry the theme. Texture costs contrast.

## Themes

| | Chalk (dark, default at night) | Whiteboard (light, bright rooms) |
|---|---|---|
| Background | Slate `#1A1F1D` | Paper `#F3F4EF` |
| Numbers / text | Chalk `#ECEDE4` (14.2:1) | Ink `#141816` (16.2:1) |
| Secondary text | `#A3ACA5` (7.2:1) | `#4E5651` (6.9:1) |
| Active player card | Raised slate `#2E3833` + chalk-yellow outline | **A little chalkboard:** slate card, chalk text, on paper |
| Accent (countdown, selected toggle, mic) | Chalk yellow `#EBDB79` | Slate `#1A1F1D` |
| Treble | Chalk green `#93D3A2`, fill | Board green `#175C3D`, fill |
| Double | Chalk orchid `#E7A3F0`, double outline | Plum `#9B2A8F`, double outline |
| Bust | Chalk red `#F29A8B` | Red `#B02A20` |

- **Theme choice:** follow the system appearance by default. A one-tap **Bright room** switch sits in the in-game menu (and in Settings), and it is remembered per device. Safari has no ambient-light sensor, so this can't be automatic.
- **Why light for bright rooms:** under glare both themes keep a similar ratio (≈5:1 in direct sun through glass, ≥16:1 by a window). Dark-on-light still reads better in bright surroundings: the pupil narrows, and bright-on-dark text halates, especially with astigmatism.

## Doubles vs trebles: never colour alone

Every dart is coded three ways: **letter + shape + colour**.

| Dart | Letter | Shape | Colour |
|---|---|---|---|
| Single | none: `8` | plain, no border | text colour |
| Double | `D16` | **double-line outline** (two 2 pt rules) | orchid / plum |
| Treble | `T20` | **solid fill** | chalk green / board green |
| Bull 50 | `BULL` | double-line outline (it is a double) | orchid / plum |
| Outer bull 25 | `25` | plain | text colour |
| Miss | `–` | dashed muted outline | muted |

- The same coding is used everywhere a dart appears: turn-strip chips, checkout hints, the turn log, history, the Voice Test Lab and the S/D/T toggle. The DOUBLE key has the double outline and the TREBLE key has the fill when selected.
- **Why orchid, not red, for doubles:** simulated colour-blind vision put red/salmon doubles next to green trebles at ΔE 10 under deuteranopia (nearly the same beige). Orchid/plum gives ΔE ≥ 38 under protanopia, deuteranopia and tritanopia. Red then means only one thing: bust.
- **Cricket marks** are shapes already (`/`, `X`, `ⓧ`) and use the text colour.

## Two in-game views

From the oche the screen is about **2.4 m away**. Sizes are set against ISO 9241-303 / ANSI-HFES 100 character height: **≥ 16′ minimum, ≥ 20′ preferred**. For scale, a 20/20 letter is 5′.

### Hand view (keypad visible)
For tapping darts in, at arm's length.
- The **remaining score** is still sized for the oche: **104 pt** Barlow Condensed ExtraBold, 11.6 mm digits, **17′ at 2.4 m** on the smallest iPhone. The 2-up cards fit "180" with room to spare (124 of 148 pt).
- With 3–8 players, the active row stays at 104 pt and the other rows use 52 pt (read at the phone).
- Turn total 72 pt, chips 34 pt, checkout hint 22 pt, stats 16 pt, keys 24 pt. All are ≥ 16′ at 0.35 m.

### Distance view (keypad collapsed)
For voice from the oche. It turns on automatically in **hands-free** mode. In push-to-talk mode it's one tap ("Big numbers") and remembered.
- **Active remaining: 200 pt**, fit to width: 22 mm digits, **32′**.
- **Turn total: 112 pt**, **18′**. This is the number that confirms what was heard.
- Other players: 104 pt (17′) for 2–4 players; 72 pt (11′) for 5–8 players.
- Chips and checkout route: rows of chips at **64 pt** (10′, i.e. 2× a 20/20 letter). Three "T20" chips fit on the smallest iPhone (327 of 343 pt). Rows with wide chips ("BULL") scale down to fit. They are secondary to the big turn total, and spoken read-back is available.
- The keypad collapses to a 56 pt bar: **Undo · mic status · Keypad ▴**.

```
┌──────────────────────────────────────┐
│ 501 · Leg 2                   ☀︎   ⋯  │  ☀︎ = Bright room
│ ▶ SAM                       legs 1   │
│                                      │
│          1 1 2                       │  200 pt, fit to width
│                                      │
│  [T20] [ 12 ] [D20]                  │  checkout route, 64 pt chips
│  [T12] [T12] [ 8 ]                   │  this turn, 64 pt chips
│                 = 80                 │  112 pt turn total, countdown ring
│  ALEX 237     JO 301                 │  104 pt (2–4 players)
├──────────────────────────────────────┤
│ [Undo]   ● Listening…   [Keypad ▴]   │  56 pt bar
└──────────────────────────────────────┘
```

## Typography

- **Numbers:** Barlow Condensed ExtraBold (800). Digits are 0.714 em tall, and "180" is 1.196 em wide (measured). Use tabular numerals. Weight never drops below 700 for any number read from the oche: thin strokes vanish at distance.
- **Interface:** Atkinson Hyperlegible (400/700), designed for low-vision legibility. Never below 16 pt in game.
- Both are SIL Open Font License, self-hosted with the app (not loaded from Google at runtime), so they work offline.

## Still to verify on a real phone

The numbers above are computed. The on-phone test page (`/readability/` on the Pages site, built alongside the Vosk prototype) lets you prop your iPhone by the board, step back to the oche, and confirm both views in both themes, including in a bright room.
