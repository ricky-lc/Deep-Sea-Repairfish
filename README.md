# Deep-Sea Repairfish

A browser-based deep-sea cable repair game. Swim through the dark ocean, fix broken cables and evade predators — solo, in expanded story mode, or in LAN multiplayer on the same Wi‑Fi.

## Play

Open `index.html` in any modern browser for solo and story mode.

### Optional: serve over HTTP

For LAN multiplayer (host/join room), PWA support, or just a local URL:

```bash
# Node.js (zero dependencies)
npm start            # or: node server.js --port 3000

# Python (stdlib only)
python3 local_test_server.py
```

Then open `http://localhost:8000`.

## Controls

| Action | Host (Repair Fish) | Joiner (Saboteur) |
|--------|---------------------|-------------------|
| Move | WASD / Arrows | Arrow Keys |
| Sprint (once) | Shift | Enter |
| Mama Fish (Easy/Normal solo only) | Space | — |

Mobile: on-screen joystick + action buttons.

## Credits

Ricky-lc · GabriPav · AntoMarl

## License

This project is source-available under **BUSL-1.1**. See `/LICENSE`.
