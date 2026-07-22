# Stonks

A standalone Android app for tracking stock trends, generating rule-based buy/sell
signals, and trading — in a free local paper-trading simulator by default, or for
real through your own Alpaca brokerage account.

## Getting the APK

Every push builds a standalone release APK via GitHub Actions — the JavaScript bundle is
compiled into the app itself, so it never needs Metro or a dev server running to work.
To install it on a phone:

1. Open the **Actions** tab on this repo and pick the latest successful "Build Android APK" run.
2. Download the `stonks-apk` artifact and unzip it to get `app-release.apk`.
3. Copy it to your Android phone and open it (you'll need to allow "install unknown apps" for
   whichever app you use to open the file).

No Play Store, no backend server to host — the app talks directly to market data and
(optionally) Alpaca's API from the device.

## Desktop app

The same codebase also ships as a desktop app (Windows/macOS/Linux) via a React Native Web
export wrapped in a minimal Electron shell. It's the same portrait, phone-shaped UI running in a
sized-to-match window rather than a reflowed desktop layout — it works, but it isn't a redesign.
The on-device local AI model (llama.rn) isn't available on desktop since it's a native mobile-only
module; use a cloud AI provider in Settings instead.

Every push builds installers for all three platforms via GitHub Actions ("Build Desktop App").
Download the artifact for your OS from the **Actions** tab and run it — Windows gets an `.exe`
installer, macOS a `.dmg`, Linux an `.AppImage`. These builds are unsigned, so your OS may warn
before letting you run them.

To build locally:

```bash
npm install
npm run desktop        # exports the web build and launches it in Electron
npm run desktop:build   # packages installers into release/ for your current OS
```

## Features

- **Watchlist** — track any ticker, see live quote + a rule-based signal at a glance.
- **Signals** — transparent scoring from moving-average crossovers, RSI, MACD, and volume
  spikes, with plain-English reasons for every point. No black-box ML (yet).
- **Paper trading** — simulated buy/sell with a $100,000 starting balance, tracked entirely
  on-device. No account required.
- **Live trading** — optional, gated in Settings: add your own Alpaca API keys and flip a
  switch (with a confirmation prompt) to place real orders instead of simulated ones.
- **Portfolio** — cash balance, positions, unrealized P&L, and trade history.

## Development

```bash
npm install
npm run android   # requires Expo Go or a connected device/emulator for local dev
npx tsc --noEmit  # type-check
```

To build the native Android project locally (requires the Android SDK):

```bash
npx expo prebuild -p android
cd android && ./gradlew assembleRelease
```

## Roadmap ideas

- ML-based predictions once there's enough on-device signal history to backtest against.
- Price/signal alerts (push notifications).
- A stock screener across a broader universe of tickers.
- News/sentiment feed tied to watchlist symbols.
