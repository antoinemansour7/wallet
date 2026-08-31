// ─── Preview mode ─────────────────────────────────────────────────────────────
// One switch, imported by everything that needs to know. Designing a UI against
// empty states tells you almost nothing — you need real shapes: long company
// names, negative returns, a CDR, a leveraged ETF, an account with two
// statements in it. So preview mode does not just bypass sign-in, it seeds a
// portfolio that exercises the parts of the UI that break.
//
// Guarded on import.meta.hot, which only the dev server provides and `vite
// build` strips. See the note in AuthContext for why not import.meta.env.DEV.

export const IS_PREVIEW = Boolean(import.meta.hot) && import.meta.env.VITE_MOCK_AUTH === 'true'

export const PREVIEW_UID = 'mock-preview-user'

const position = ({
  account, symbol, description, qty, price, book, dayPct, currency = 'CAD', source,
}) => {
  const value = qty * price
  const dayChange = value * (dayPct / 100)
  return {
    'ACCOUNT NUMBER': account,
    'ACCOUNT CURRENCY': currency,
    SYMBOL: symbol,
    DESCRIPTION: description,
    QUANTITY: String(qty),
    'MARKET PRICE': price.toFixed(2),
    'MARKET VALUE': value.toFixed(2),
    'BOOK VALUE': book.toFixed(2),
    'DAY CHANGE': dayChange.toFixed(2),
    'DAY CHANGE %': `${dayPct.toFixed(2)}%`,
    'UNREALIZED GAIN/LOSS': (value - book).toFixed(2),
    'UNREALIZED GAIN/LOSS %': `${(((value - book) / book) * 100).toFixed(2)}%`,
    __sourceId: source,
  }
}

// Deliberately mixed: winners and losers, a CDR, a Canadian leveraged ETF whose
// logo resolves through the underlying, a long description that has to truncate,
// and one account built from two different statements.
const TFSA = 'file:questrade-tfsa'
const TFSA_2 = 'file:wealthsimple-tfsa'
const RRSP = 'plaid:wealthsimple'

const POSITIONS = [
  position({ account: '68BB39Q', symbol: 'NVDA', description: 'NVIDIA CORP', qty: 42, price: 178.4, book: 5900, dayPct: 1.84, source: TFSA }),
  position({ account: '68BB39Q', symbol: 'CRWD', description: 'CROWDSTRIKE HOLDINGS INC CLASS A', qty: 18, price: 226.8, book: 4720, dayPct: 3.85, source: TFSA }),
  position({ account: '68BB39Q', symbol: 'AVGO', description: 'BROADCOM INC CDR C$HDG', qty: 655, price: 15.3, book: 8848.86, dayPct: -0.42, source: TFSA }),
  position({ account: '68BB39Q', symbol: 'HSU.TO', description: 'BETAPRO SP500 2X DAILY BULL ETF', qty: 200, price: 26.47, book: 6100, dayPct: -2.21, source: TFSA }),
  position({ account: '68BB39Q', symbol: 'AC.TO', description: 'AIR CANADA VOTING & VARIABLE VOTING SHARES', qty: 340, price: 18.92, book: 7400, dayPct: 0.64, source: TFSA }),
  position({ account: '68BB39Q', symbol: 'NVDL', description: 'GraniteShares 2x Long NVDA Daily ETF', qty: 60, price: 34.4, book: 2400, dayPct: 3.6, source: TFSA_2 }),
  position({ account: '68BB39Q', symbol: 'T.TO', description: 'TELUS CORP', qty: 210, price: 21.05, book: 4900, dayPct: -0.28, source: TFSA_2 }),

  position({ account: '68BB39W', symbol: 'VFV.TO', description: 'VANGUARD S&P 500 INDEX ETF', qty: 96, price: 148.2, book: 12100, dayPct: 0.41, source: RRSP }),
  position({ account: '68BB39W', symbol: 'XEQT.TO', description: 'ISHARES CORE EQUITY ETF PORTFOLIO', qty: 210, price: 36.44, book: 7300, dayPct: 0.33, source: RRSP }),
  position({ account: '68BB39W', symbol: 'SHOP.TO', description: 'SHOPIFY INC CLASS A SUBORDINATE VOTING', qty: 45, price: 152.6, book: 8200, dayPct: -1.12, source: RRSP }),
  position({ account: '68BB39W', symbol: 'ENB.TO', description: 'ENBRIDGE INC', qty: 180, price: 62.15, book: 10400, dayPct: 0.18, source: RRSP }),
  position({ account: '68BB39W', symbol: 'SLB', description: 'SCHLUMBERGER NV', qty: 120, price: 58.47, book: 8100, dayPct: 1.98, source: RRSP, currency: 'USD' }),
]

export const PREVIEW_PORTFOLIO = {
  fileName: 'preview-sample.csv',
  rows: POSITIONS,
  accounts: {
    '68BB39Q': {
      accountNumber: '68BB39Q',
      currency: 'CAD',
      positions: POSITIONS.filter((p) => p['ACCOUNT NUMBER'] === '68BB39Q'),
      cash: 4972.54,
      cashSource: 'explicit',
      realizedPnl: 1240.18,
    },
    '68BB39W': {
      accountNumber: '68BB39W',
      currency: 'CAD',
      positions: POSITIONS.filter((p) => p['ACCOUNT NUMBER'] === '68BB39W'),
      cash: 812.09,
      cashSource: 'inferred',
      realizedPnl: -318.44,
    },
  },
  lastPriceRefreshAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}
