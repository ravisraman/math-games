# Math Quest 数学探险

A small portal of four math games for a 2nd grader. It works on a **MacBook** (played with
the arrow keys, space bar and return key, so no typing is needed) and on an **iPhone**
(tap, swipe and drag, upright or sideways). Progress saves automatically.

**Play online:** https://ravisraman.github.io/math-games/

## On the iPhone

Open the link above in Safari, tap the **Share** button, then **Add to Home Screen**. Math
Quest then opens full-screen like an app, with its own icon, and keeps working offline.
Each device keeps its own progress; use **⚙️ → Download backup / Restore backup** to move it.

| Game | Laptop | iPhone |
|------|--------|--------|
| Coin Crossing | arrow keys, space = put back | tap to hop up, swipe to turn, ↩ Put back button |
| Number Flow | arrow keys + space, or drag with the trackpad | drag paths with a finger |
| Clock Tower | ← → long hand, ↑ ↓ short hand, return | drag the hands, or use the 5 min / 1 hour buttons |
| Castle Climb | ← → walk, ↑ jump | tap the right answer |

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
- **Cars** send you back to the start and your coins fly back to their spots, so the level starts over.
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

### 🔗 Number Flow (playable)

A Flow Free–style puzzle. Draw a path from each colored dot to its partner, and make the
numbers along the path add up to exactly the dots' target. A live running sum sits at the
tip of the path, and the side panel shows the addition sentence (in Chinese too). Boards
grow from 4×4 with 2 pairs up to 7×7 with 5 pairs. Music: Pachelbel's Canon.

### 🕰️ Clock Tower (playable)

Be the village clock keeper. Set the clock with the arrow keys (← → long hand, ↑ ↓ short
hand), read clocks, match "quarter past / half past / quarter to", and work out elapsed time.
Each right answer lights a tower window, and the top rings the bell. Levels go from o'clock
and half past up to 1-minute times and elapsed time that crosses the hour. Music: Bach's
Minuet in G.

### 🏯 Castle Climb (playable)

Addition and subtraction fact fluency. Walk under the ledge with the right answer and jump
to climb the pagoda. A wrong ledge crumbles gently, and a strategy hint appears (make a ten,
doubles, count on, think addition). Missed facts come back later. Levels go from sums
within 10 up to 2-digit regrouping, three addends and missing numbers. Music: Beethoven's
Für Elise.

### Sounds and music

All sounds are synthesized in the browser: soft harp, music box, bass and timpani with a
gentle reverb. Each game plays a public-domain classical piece. Press **M** to turn music on
or off; grown-ups can also switch music, sounds, read-aloud and Chinese numbers separately.

## Project layout

```
index.html, portal.css, portal.js   the portal (game picker, heroes, grown-ups corner)
shared/core.js                      save data, sounds, read-aloud, money + Chinese number helpers
shared/style.css                    shared look (colors, coins, key caps)
games/coin-crossing/                Coin Crossing
games/number-flow/                  Number Flow
games/clock-tower/                  Clock Tower
games/castle-climb/                 Castle Climb (problems.js holds the math generator)
manifest.webmanifest, sw.js, icons/ home-screen app + offline support
```

Plain HTML, CSS and JavaScript. There is no build step and nothing to install.
