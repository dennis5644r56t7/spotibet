# Reference: Real Spribe Aviator (scraped from Betika KE)

Source: `https://www.betika.com/en-ke/aviator/` → iframe → `https://demo.spribe.io/launch/aviator`
Direct game: `https://airplane-demo.spribegaming.com/?currency=KES&operator=demo&jurisdiction=CW&lang=EN`
Version seen: `v4.2.116-hotfix-3`

Files here:
- `page.html` — Betika landing page shell
- `real-flying.jpeg` — screenshot mid-flight (1.84x)
- `real-flewaway.jpeg` — screenshot at crash (5.31x FLEW AWAY)
- `assets/aviator-plane-reviced.png` — plane art from Betika CDN

## Arena (canvas, WebGL)

The board is a **single canvas** inside `.stage-canvas` (`border-radius: 20px`, `overflow: hidden`).
Size at 716px viewport: `706 x 387` (~1.82:1). Parent `.play-board-wrapper`.

Background is painted, not CSS:
- Base: **pure `#000000`**
- Rotating **sunburst rays** radiating from the **bottom-left corner**, wedge colour `#0c0c0c`–`#0e0e0e`
  on black. This is the only background texture. Rays rotate slowly.
- **No dashed/concentric radar circles.** (My earlier version wrongly added these.)
- A soft **teal/steel-blue glow** sits low-centre, roughly `rgba(32,98,133)` core fading out,
  sampled values `#206285`, `#1d5d78`, `#154865`, `#0c2635`. It reads as light from the runway.

### Flight curve
- Fill: **dark maroon**, sampled `#6e0816` / `#6d0714` / `#67010e` — fairly opaque, low luminance.
- Stroke: **bright crimson `#e71542`**, ~2.5px, soft glow.
- Curve starts at the **bottom-left origin** and rises to the plane's tail.
- Plane sprite sits at the curve's tip, tail touching the line.
- On crash the curve disappears immediately; plane zooms off up-right.

### Crash state
Rays stay. No curve. Large `FLEW AWAY!` text + multiplier centred.

## FUN MODE bar
- `background: rgba(229, 148, 7, 0.8)` (amber, translucent)
- `color: #ffffff`, `font-size: 14px`, `font-weight: 700`, `height: 23px`
- **Solid amber, not a yellow gradient.** Full-bleed across the top of the board.

## Chrome / panels
| Element | Value |
|---|---|
| `.main-container` | `#0e0e0e` |
| `.bets-block` | `#1b1c1e`, radius `20px` |
| `.total-win-container` | `#141516`, radius `14px` |
| Tab pill container | `#141516`, border `4px solid #141516`, radius `64px` |
| Active tab ("Bet") | `#2c2d30`, radius `32px`, color `#ebebeb`, 12px, h `24px` |
| Inactive tab ("Auto") | transparent, color `#a3a3a3`, 12px |
| Bet amount text | `#fafafa`, `22px` |
| Quick chips (100/200/500/10,000) | `rgba(255,255,255,0.5)`, `14px` |
| **Bet button** | `#28a809`, radius `12px`, h `80px`, `22px`, color `#fafafa`, **flat, no gradient/shadow** |
| Panel row bg | `#1b1c1e` |
| Bets list rows | `#141517` / `#1f2022` alternating |

## Layout order (mobile)
1. Top strip: recent multipliers (`5.31x 1.05x 4.84x …`) on black, balance right
2. FUN MODE bar (amber)
3. Arena canvas
4. Two bet panels side-by-side (Bet/Auto tabs, − amount +, chips, green Bet button)
5. All Bets / Previous / Top tabs
6. Bets list with player avatars, bet, X, win
