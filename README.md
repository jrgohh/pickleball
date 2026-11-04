# Pickleball (TV + phone paddles)

The computer on the TV runs the game. Each phone scans the QR code and becomes a motion paddle.

## Deploy (Cloudflare Pages)

It's a static site with no build step. Deploy the folder that contains `index.html`.

Option A, dashboard: Cloudflare > Workers & Pages > Create > Pages > Upload assets > drop this folder.

Option B, PowerShell:

```powershell
cd path\to\pickleball
npx wrangler pages deploy . --project-name pickleball
```

Leave out the `Test` and `Temporary` folders when you upload.

HTTPS is required. iPhones only share motion data with HTTPS pages, and Pages gives you HTTPS automatically.

## Play

1. Open `https://<your-project>.pages.dev/` on the computer. Fullscreen it with F11.
2. Scan the QR code with each phone, type a name, then tap **Join game**. On iPhone, tap **Allow** when asked for motion access.
3. Pick the mode on the TV: 1 v 1, 1 v CPU, or 2 v 2 CPU (both phones on one team).
4. Press Enter on the computer, or tap **Start game** on Player 1's phone.

### Controls
- Hold the phone like a paddle handle, screen facing sideways, and swing.
- Your player runs to the ball automatically. A coloured ring under your player and a coloured border on your phone mean the next ball is yours.
- **Timing sets the direction.** An early swing pulls the ball across the court, a late swing pushes it the other way, and swinging right on time sends it straight. Very early or very late swings tend to go out or into the net.
- **Swing strength sets the depth.** A gentle swing plays a dink or drop, and a hard swing plays a deep drive.
- Hold **Dink** to force a soft shot. Hold **Lob** to send the ball high and deep.
- If the swing doesn't register, change Sensitivity on the join screen.
- If the phone has no motion sensors, tap the big area to swing.

### Rules modelled
Standard court size and kitchen. The serve must land in the diagonal box past the kitchen line. Two-bounce rule. No volleys in the kitchen (the auto-movement enforces this). Faults for out, net, and double bounce. Traditional side-out scoring to 11, win by 2, with doubles score calls (0-0-2 start, second server). You can switch to rally scoring in the config.

## Test without phones

- **Keyboard:** click "Add keyboard player" in the lobby. P1 uses A (soft), S (drive), D (lob). P2 uses J, K, L.
- **One-browser test:** run a local server, then open `index.html?local=1`. Open the join link shown in a second tab. That tab is a phone, and you tap it to swing.

```powershell
python -m http.server 8123
# then open http://localhost:8123/index.html?local=1
```

`Test/` holds headless rule simulations. Run them with `node Test/sim.mjs` and `node Test/human.mjs`.

## Tuning

Every tunable value is in `js/config.js`:
- `gameSpeed` (overall pace)
- `timing` (swing window size and the perfect-timing point)
- `shots` (depth and flight time of each shot type)
- `movement` (auto-run speed)
- `cpu` (speed and skill per level)
- `controller.thresholds` (phone sensitivity)

## How it connects

The phones connect straight to the computer over WebRTC through PeerJS (`vendor/peerjs.min.js`). The public PeerJS cloud server is used only for the initial handshake. Gameplay data never goes through a server.

On a normal home Wi-Fi, the phones and the computer connect directly. Strict networks, like some office or guest Wi-Fi, can block direct WebRTC connections. That would need a TURN server, which isn't set up yet.

## Files

| File | Purpose |
|---|---|
| `index.html`, `css/host.css`, `js/host.js` | TV page: lobby, QR, HUD, loop |
| `controller.html`, `css/controller.css`, `js/controller.js` | Phone paddle |
| `js/game.js` | Physics, rules, scoring, auto-movement, CPU |
| `js/render.js` | Three.js court and players |
| `js/net.js` | PeerJS transport plus the local BroadcastChannel test transport |
| `js/sound.js` | Synthesised hit and bounce sounds |
| `js/config.js` | All tunable values |
| `vendor/` | three.js r187, PeerJS, qrcode-generator (bundled, no CDN) |
