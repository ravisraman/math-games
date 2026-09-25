# Math Quest 数学探险

A small, growing portal of math games for a 2nd grader. It is built for a MacBook and
played with the **arrow keys, space bar and return key**, so no typing is needed.
Progress saves automatically.

## How to play

**Easiest:** download this repository (green **Code** button → **Download ZIP**), unzip it,
and double-click `index.html`. It opens in Safari or Chrome, and nothing needs to be installed.

**Or run a tiny local server** (this keeps saved progress in one stable place):

```sh
cd math-games
python3 -m http.server 8000
# then open http://localhost:8000
```

Progress is stored in the browser (`localStorage`), so always use the **same browser** on the
same Mac. The **Grown-ups** button on the portal lets you download a backup file and restore
it later or on another computer.

## Games

### 🪙 Coin Crossing (playable)

A Crossy Road–style game. Hop across grass and roads with the arrow keys and collect coins
that add up to **exactly** the amount the castle needs. Then hop into the castle at the top.

- **Too much?** If a coin would go over the target, the game won't take it. It explains why:
  *"38¢ + a quarter (25¢) would be 63¢. You only need 9¢ more."*
- **Space** puts the last coin back, so the player can never get stuck.
- **Cars** bump you back to the start. Your coins stay safe in your pouch.
- **Bonus question** after every level: adding 2–3 numbers, counting coins, subtracting,
  making change, and converting cents to dollars and back. Weaker skills come up more often.
- **Chinese numbers** (optional): amounts also appear as 四十七分 / 一元三角五分
  (角 = dime), and praise is spoken in Mandarin (太棒了!).
- **Read aloud:** targets and questions are spoken for early readers.

**Adaptive levels**

| Level | Coins | Target | Written as |
|------:|-------|--------|------------|
| 1–2 | penny, nickel | 3–20¢ | cents |
| 3–4 | + dime | 11–60¢ | cents |
| 5–7 | + quarter | 25–99¢ | cents |
| 8–9 | + $1 bill | $1.00–$1.99 | dollars |
| 10–13 | up to $1 bills | $1.00–$4.00 | **mixed**: castle and pouch use different formats, so he has to convert |
| 14+ | + $5 bill | $2.00–$9.99 | mixed |

Roads, car speed and the number of extra "distractor" coins also increase with the level.
After each level:

- **3 stars** (≤1 "too much" and ≤1 bump): level up.
- **2 stars** twice in a row: level up.
- **1 star** twice in a row: level down.

A grown-up can also set the level by hand with the −/+ buttons in **Grown-ups**.

Stars unlock new heroes (🐸 🐼 🐯 🐲 🦄 🤖 🦖) on the portal.

### Coming next

- 🕰️ **Clock Tower**: move the hands to set the time before the bell rings (hour/minute hands, elapsed time).
- 🔗 **Number Flow**: a Flow Free–style puzzle where the paths must add up to a target number.
- 🏯 **Castle Climb**: fast addition and subtraction facts to climb the tower.

## Project layout

```
index.html, portal.css, portal.js   the portal (game picker, heroes, grown-ups corner)
shared/core.js                      save data, sounds, read-aloud, money + Chinese number helpers
shared/style.css                    shared look (colors, coins, key caps)
games/coin-crossing/                the Coin Crossing game
```

Plain HTML, CSS and JavaScript. There is no build step and nothing to install.
