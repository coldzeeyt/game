# Precipice

An 8-bit style 2D platformer by **ColdzeeYT**. Climb the cliffs, don't fall off the edge, and
find out who, or what, is watching you.

## Story

At the top of Mount Precipice burns the **Everflame**, a fire that grants a single wish. Years ago a
climber named **Ash** set out to find it and never came back down. Last night, at the foot of the
cliffs, you found Ash's red cap. It fit you perfectly.

**Objective:** reach the summit and find the Everflame. Gather embers along the way, and find
Ash's memories to learn the truth.

## Play

Open `index.html` in a browser. Or serve the folder so the music loads in every browser:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

### Download

Every push to `main` builds the apps with GitHub Actions (`.github/workflows/build.yml`) and
publishes them as the latest release:

- **Windows:** [Precipice.exe](https://github.com/coldzeeyt/precipice/releases/latest/download/Precipice.exe)
  (one portable file, everything packed inside; just run it)
- **Android:** [Precipice-Android.apk](https://github.com/coldzeeyt/precipice/releases/latest/download/Precipice-Android.apk)
- **iPhone / any phone:** open the GitHub Pages site and use *Add to Home Screen*. It installs as a
  full-screen app that also works offline.

The title screen shows **Download for PC** (desktop browsers) or **Download for Android**
(Android browsers).

### Versions

The game's version (e.g. **1.8**) is `GAME_VERSION` in `js/config.js`. It shows on the title screen,
and each GitHub release is named after it ("Precipice 1.8"). When you ship a new update, bump it and
add a matching page at the top of the changelog (`CHANGELOG` in `js/game.js`).

### Automatic updates (Windows)

Precipice.exe updates itself. Every push to `main` builds a new release (`build-N`), and each exe
knows its own build number. When the game starts it checks the latest release; if there's a newer
one it downloads it next to the exe and asks to restart (or installs it when you close the game).
You can also check any time in **Settings > Updates**. Exes from before this feature need to be downloaded once more by hand.

### Desktop app (Electron) from source

```sh
npm install
npm start       # run it
npm run dist    # build dist/Precipice.exe (on Windows)
```

F11 toggles fullscreen in the desktop app.

### Phones & tablets

On touch screens, on-screen buttons appear: a D-pad (move / aim dash), **JUMP**, **DASH**
and **II** (pause / back). Tap menu items to pick them. Hold the phone sideways.

## Controls

| Key | Action |
| --- | --- |
| A / D | Move left / right |
| Space | Jump (hold to jump higher) |
| Shift (or K) | Dash, aimed with W / A / S / D |
| Esc | Pause |
| W / S + Enter | Navigate menus (the mouse works too) |

The **Tutorial** on the title screen walks through every mechanic.

## The campaign

Two acts, 102 stages in all. Plan on several hours for a first run through Act I, and more for
Act II, especially if you hunt down every ember and memory.

**Act I**

| Chapter | Name | What's new |
| --- | --- | --- |
| 1 | The Foothills | Gentle warm-up: jumps, spikes, springs, crumbling bridges, moving platforms |
| 2 | The Cliffs | Dashing, dash crystals, tall walls to climb |
| 3 | The Storm | Rain and wind gusts that push you back |
| 4 | The Frozen Pass | Slippery ice |
| 5 | The Summit | Everything at once |
| Boss | **The Watcher** | Your shadow. Dash into it while it's dazed (5 hits), then reach the Everflame |

**Act II**: unlocked after beating the Watcher (*Continue the story* on the ending screen,
or Continue / Load Game on the title screen).

| Chapter | Name | Flavour |
| --- | --- | --- |
| 6 | The Far Side | The unmapped side of the mountain |
| 7 | The Sunken Caves | Dark caves full of crumbling ground and crystals |
| 8 | The Ashen Wastes | Hot wind and lots of moving platforms |
| 9 | The Glass Peaks | Ice and wind together |
| 10 | The Hollow Crown | Everything, at its hardest |
| Boss | **The Hollow** | The first climber. 7 hits, faster attacks, a spiked arena. Leads to the true ending |

Stage 1-1 is hand-made. The others are built from small, individually tested sections by a
seeded generator (`js/levels.js`), so every stage is the same on every playthrough.

## Mechanics

- **Tight platforming**: coyote time, jump buffering, variable jump height and a floatier apex.
- **Wall slide & wall jump**: hold into a wall to slide down it, press jump to kick off.
- **Dash**: one air dash in 8 directions. It recharges when you land. Your cap turns blue when it's spent.
- **Dash crystals** refill your dash in mid-air.
- **Springs**, **crumbling blocks**, **moving platforms**, **spikes** and **checkpoints**.
- **Climbing**: hold toward a wall and tap jump to climb it; jump without holding to kick off.
- **Wind** (Chapter 3+): gusts push you back. Wait for the calm, then jump.
- **Ice** (Chapter 4+): you speed up and slow down slowly.
- **Ladders**: hold up or down to climb; you can stand on top of them.
- **Wooden platforms**: jump up through them and land on top; press down to drop back through.
- **Puzzles**: keys open locked gates; switch orbs flip the blue and red blocks.
- **Saw blades** (Chapter 2+) and **fire vents** (Chapter 3+).
- **Embers**: optional collectibles.

## The mystery

Violet rune stones hold **memory fragments**: pages from Ash's diary in Act I, and carvings
left by the very first climber in Act II.
Something that wears your face appears ahead of you on the cliffs and vanishes when you
approach. Collect every fragment in a stage to see what it has to say.

## The ending

Beating the Hollow (10-B) shows the true ending, then the **credits roll**: the credits,
special thanks (Celeste, Geometry Dash platformer mode, Newgrounds), a note from the dev,
an epilogue, and a last little scene of Ash at a campfire, all set to "This Should Be in a
Video Game" by Pianomations (it fades out at the end). Hold any key to speed it up, Esc to skip.

## Saving

There are **3 save slots**. Touching a checkpoint, finishing a stage and quitting to the title
all save (stage, checkpoint, embers, memories, deaths and time). **Continue** resumes your most
recent slot; **Load Game** lets you pick one.

### Accounts and cloud saves (ACCOUNT, bottom left of the title screen)

Make an account with a name and password (**Sign up**), or **Log in** on any device. Then:

- **Save** copies this device's saves (all 3 slots, the Hardcore run, settings and key bindings) to the cloud
- **Load** replaces this device's saves with the cloud copy (it asks you to press twice)
- **Log out** signs this device out

The account server is `server/` (plain Node, no dependencies). It stores passwords only as salted
scrypt hashes and keeps everything in one JSON file under `DATA_DIR`. It runs on Railway at
`https://precipice-accounts-production.up.railway.app` (root directory `/server`, a volume on `/data`).
To run your own: `cd server && DATA_DIR=./data node server.js`, then change `ACCOUNT_SERVER` in
`js/account.js`.

### Hardcore mode (MORE, bottom right of the title screen)

No checkpoints: die and the stage starts over. A Hardcore run only saves when a new chapter
begins, so you can leave between chapters but not mid-chapter.

## Title screen

- **Continue**: resume your most recent save slot
- **New Game**: pick a slot, then the backstory (Esc skips it)
- **Load Game**: pick any of the 3 save slots
- **Tutorial**: teaches every mechanic
- **Guide**: your goal, the collectables, everything on the mountain, and the controls
- **Lore**: Mount Precipice, Ash, the memory fragments, the Watcher, and you; plus Wren, the Black Flame and what came after (these pages unlock as you reach that part of the story)
- **Settings**: resolution, fullscreen, music/sound volume, and graphics presets from
  *Bare Bones* → *Simple* → *Standard* → *Detailed* → *Full Detail*,
  and key bindings (Controls)
- **Messages** (Account > Messages): players can message the dev (COLDZEEYT) and the dev can message any player from Dev Notes > Players, which also shows who's online. Players can't message each other. Messages are kept on the account server
- **Dev Notes** (top left): news and plans from the dev. Everyone can read them; only the `COLDZEEYT` account can write (checked by the account server)
- **Stories** (top): Story 1 is Precipice; more storylines are coming (greyed out for now)
- **Credits**, plus the **Changelog** (what's new in each update)
- **Account** (bottom left): sign up / log in / log out, and save or load your saves in the cloud
- **More** (bottom right): Hardcore mode, **Only Up** (one 720 m tower, no checkpoints: your spot saves when you quit, best height is kept), and **Multiplayer** (make a room and race your friends with its 4-letter code)
- Use LEFT / RIGHT on the menu to reach the two corner buttons

## Credits

- Game & design: ColdzeeYT
- Music: "Silver Hand Man" by viraxor (title), "This Should Be in a Video Game" by Pianomations (end credits), "I Made This and Then Cried Until 3 AM" by disappiercing (endings)
- Source: https://github.com/coldzeeyt/precipice
- Playtesters: pugsnpigs, ColdzeeYT

## Project layout

```
index.html          page + canvas
main.js             Electron entry point (desktop app)
manifest.webmanifest, sw.js   installable / offline web app
js/touch.js         on-screen buttons for phones
icon.png / .ico     app icon (Ash in the red cap)
js/config.js        settings: resolution, graphics presets, volume
js/font.js          5x7 and 3x5 bitmap pixel fonts
js/gfx.js           sprites, tiles, decorations, background (all drawn in code)
js/audio.js         title music + synthesized 8-bit sound effects
js/levels.js        tutorial and stage 1 layouts (small builder API)
js/net.js           online multiplayer rooms (PeerJS)
js/account.js       accounts and cloud saves (talks to server/)
js/game.js          input, scenes, player physics and rendering
server/             account + cloud save server (deployed on Railway)
assets/music/       title song, ending theme and credits song
```
