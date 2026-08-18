# GameAnalytics: create the game and connect it

The code side is already done:
  the client lazy-loads the GameAnalytics SDK and starts it
  as soon as the server hands it keys via `GET /config.js`.
This manual is only the by-hand part —
  creating the account, getting the two keys,
  and putting them into the Timeweb panel.

## 1. Create the account

Go to <https://go.gameanalytics.com/signup>.
Sign up with email (free, no card), confirm the email link.

## 2. Create the game

After first login the tool offers **Add game** —
  or use the `+` button in the left sidebar of
  <https://tool.gameanalytics.com>.

- **Platform / engine:** choose **HTML5** (web game).
- **Game name:** use the public name of the game,
  e.g. "Ochre Eights" — not "UNO"
  (the trademark must not appear in external services).
- Studio/organization: whatever it suggests; defaults are fine.

## 3. Copy the two keys

In the game's workspace open
  **Settings (gear icon) → Game information**.
Copy:

- **Game Key** — 32 hex characters;
- **Secret Key** — 40 hex characters.

Both are client-side keys and will be visible
  in the browser bundle by design; that is GameAnalytics' model.

## 4. Connect them to the site

Timeweb panel → your app → переменные окружения → add:

```
GA_GAME_KEY=<Game Key>
GA_SECRET_KEY=<Secret Key>
```

Restart the app (or let the next deploy do it).
Nothing else is needed:
  on the next page load `GET /config.js` carries the keys,
  the client pulls the SDK chunk and initializes it.

## 5. Verify (takes ~5 minutes)

1. Open `https://<app-domain>` and play a short round.
2. `view-source:https://<app-domain>/config.js` —
  the keys should be present (not `null`).
3. DevTools → Network — requests to `api.gameanalytics.com`
  appear after the page loads.
4. GameAnalytics tool → **Realtime** — your session shows up
  within a few minutes.

## 6. What arrives automatically

- Sessions, DAU/MAU, retention, average playtime —
  the SDK tracks these on its own.
- Design events from the game, under **Explore → Design events**:
  `game:room_created`, `game:room_joined`,
  `game:round_started`, `game:round_finished`.

## 7. Testing from a dev machine

Create a **second** game in GameAnalytics (e.g. "Ochre Eights Dev"),
  put its keys into `client/.env`
  as `VITE_GA_GAME_KEY` / `VITE_GA_SECRET_KEY`.
That keeps test sessions out of the production numbers;
  the production keys served by `/config.js` always win
  when both are present.
