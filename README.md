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

### Desktop app (Electron)

`main.js` + `package.json` make this folder an Electron app:

```sh
npx electron .                      # run it
npx @electron/packager . Precipice --platform=win32 --arch=x64 --icon=icon.ico   # build Precipice.exe
```

F11 toggles fullscreen in the desktop app.

Every push to `main` also builds the Windows app with GitHub Actions
(`.github/workflows/build-windows.yml`) and publishes it as the latest release:
https://github.com/coldzeeyt/precipice/releases/latest/download/Precipice-Windows.zip
(the **Download for PC** button on the title screen links there).

### Phones & tablets

On touch screens, on-screen buttons appear: a D-pad (move / aim dash), **JUMP**, **DASH**
and **II** (pause / back). Tap menu items to pick them.

The game renders at 480×270 and scales up in whole steps to fill the window (4× = 1920×1080).

## Controls

| Key | Action |
| --- | --- |
| A / D | Move left / right |
| Space | Jump (hold to jump higher) |
| Shift (or K) | Dash, aimed with W / A / S / D |
| Esc | Pause |
| W / S + Enter | Navigate menus (the mouse works too) |

The **Tutorial** on the title screen walks through every mechanic.

## Mechanics

- **Tight platforming**: coyote time, jump buffering, variable jump height and a floatier apex.
- **Wall slide & wall jump**: hold into a wall to slide down it, press jump to kick off.
- **Dash**: one air dash in 8 directions. It recharges when you land. Your cap turns blue when it's spent.
- **Dash crystals** refill your dash in mid-air.
- **Springs**, **crumbling blocks**, **moving platforms**, **spikes** and **checkpoints**.
- **Embers**: optional collectibles.

## The mystery

Violet rune stones hold **memory fragments**, pages from Ash's diary.
Something that wears your face appears ahead of you on the cliffs and vanishes when you
approach. Collect every fragment in a stage to see what it has to say.

## Saving

Touching a checkpoint saves your game (checkpoint, embers, memory fragments, deaths and time).
**Continue** on the title screen resumes from there, even after closing the game.

## Title screen

- **Continue**: resume from your last checkpoint (shown once you have a save)
- **New Game**: opens with the backstory (Esc skips it)
- **Tutorial**: teaches every mechanic
- **Guide**: your goal, the collectables, everything on the mountain, and the controls
- **Lore**: Mount Precipice, Ash, the memory fragments, the Watcher, and you
- **Settings**: resolution, fullscreen, music/sound volume, and graphics presets from
  *Potato* → *Toaster* → *Grandma's Laptop* → *Gamer Rig* → *NASA PC*
- **Credits**

## Credits

- Game & design: ColdzeeYT
- Music: "Silver Hand Man" by viraxor, "Dream Girl" by shark-pool
- Source: https://github.com/coldzeeyt/precipice

## Project layout

```
index.html          page + canvas
main.js             Electron entry point (desktop app)
icon.png / .ico     app icon (a memory fragment)
js/config.js        settings: resolution, graphics presets, volume
js/font.js          5x7 and 3x5 bitmap pixel fonts
js/gfx.js           sprites, tiles, decorations, background (all drawn in code)
js/audio.js         title music playlist + synthesized 8-bit sound effects
js/levels.js        tutorial and stage 1 layouts (small builder API)
js/game.js          input, scenes, player physics and rendering
assets/music/       title screen songs (Silver Hand Man, Dream Girl)
```
