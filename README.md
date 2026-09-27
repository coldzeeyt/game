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

## Title screen

New Game (opens with the backstory; Esc skips it) · Tutorial · Settings (placeholder) · Credits

## Credits

- Game & design: ColdzeeYT
- Music: "Silver Hand Man" by viraxor, "Dream Girl" by shark-pool
- Source: https://github.com/coldzeeyt/game

## Project layout

```
index.html          page + canvas
js/font.js          5x7 and 3x5 bitmap pixel fonts
js/gfx.js           sprites, tiles, decorations, background (all drawn in code)
js/audio.js         title music playlist + synthesized 8-bit sound effects
js/levels.js        tutorial and stage 1 layouts (small builder API)
js/game.js          input, scenes, player physics and rendering
assets/music/       title screen songs (Silver Hand Man, Dream Girl)
```
