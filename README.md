# Wallet

A stock portfolio tracker with daily research. Built with React + Firebase.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite |
| Auth | Firebase (Google sign-in only) |
| Routing | React Router v6 |
| Styling | Tailwind CSS |
| CSV parsing | papaparse |
| Excel parsing | xlsx |
| Stock API | TBD (stubbed) |

## Setup

### 1. Clone & install

```bash
git clone https://github.com/antoinemansour7/wallet.git
cd wallet
npm install
```

### 2. Configure Firebase

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Authentication → Sign-in method → Google**
3. Register a web app and copy the config
4. Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Required env vars:

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

### 3. Run

```bash
npm run dev
```

## Features

### Portfolio
- Upload a CSV or Excel (.xlsx/.xls) spreadsheet of your holdings
- Table renders immediately after upload
- P&L cards (all-time, 1Y, 6M, total value) — **pending stock API integration**

### Research
- Daily market news and top movers — **pending stock API integration**

## Roadmap

- [ ] Wire up stock API (Alpha Vantage / Polygon.io / Finnhub) for real-time prices
- [ ] Compute P&L per position from uploaded spreadsheet
- [ ] Chart portfolio value over time
- [ ] Watchlist with price alerts
- [ ] Live market news feed

## Spreadsheet Format

The app accepts any CSV or Excel file. Recommended columns:

| Column | Example |
|---|---|
| Symbol | AAPL |
| Shares | 10 |
| Avg Cost | 150.00 |
| Purchase Date | 2023-01-15 |
