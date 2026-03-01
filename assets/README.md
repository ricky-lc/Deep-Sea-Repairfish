# Game Assets

## Fish skins  (`images/skins/`)

Add any PNG file here and list its filename in `skins.json`.
The fish name shown in-game is derived automatically from the filename
(extension stripped, first letter capitalised).

**Example** – adding a new skin called "Nemo":
1. Copy `nemo.png` into `images/skins/`
2. Edit `skins.json`: `["bubbles.png", "blaze.png", "moss.png", "nemo.png"]`

Recommended size: **64 × 36 px** (transparent background, fish faces right).

## Background  (`images/background.png`)

A tileable PNG used as the seabed texture across the entire world map.
If this file is absent the game draws procedural rocks and corals instead.

Recommended tile size: **128 × 128 px** (or any power-of-two square).
