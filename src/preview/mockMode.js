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

// ─── Research ─────────────────────────────────────────────────────────────────
// Shaped to hit the branches that only appear with real output: a pick above
// the cut and one below it, a confirmed catalyst and an unconfirmed one, a
// complete trade plan and one missing its levels, overbought and oversold
// readings, and a regime with a named weakest component.

export const PREVIEW_RESEARCH = {
  generatedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
  signalCount: 562,
  queryCount: 60,
  xBreakdown: { accountSignals: 130, searchSignals: 200 },
  articles: new Array(60).fill(null).map((_, i) => ({ id: i })),
  regime: {
    score: 5.1,
    label: 'Mixed',
    drag: { label: 'Interest rates', detail: 'At a one-year high and still rising, which pulls money out of stocks' },
    components: [
      { key: 'rates', label: 'Interest rates', score: 2, detail: 'At a one-year high and still rising, which pulls money out of stocks', metric: '10-year Treasury 4.76%, up 1.6% in 20 days' },
      { key: 'credit', label: 'Cost of borrowing', score: 6, detail: 'Companies can still borrow at normal cost, so nothing looks strained', metric: 'High-yield spread 3.1%, near its two-year average' },
      { key: 'vol', label: 'Nervousness', score: 5, detail: 'Traders expect an ordinary amount of movement, neither calm nor panicked', metric: 'VIX 17.4' },
      { key: 'breadth', label: 'How many stocks are rising', score: 4, detail: 'The gains are concentrated in a few large names rather than spread out', metric: '44% of the S&P above its 50-day average' },
      { key: 'trend', label: 'Market direction', score: 7, detail: 'The index is above its long-term average and has been climbing', metric: 'S&P 3.2% above its 200-day average' },
      { key: 'dollar', label: 'US dollar', score: 5, detail: 'Flat, so it is neither helping nor hurting company earnings abroad', metric: 'DXY 104.1, unchanged over 20 days' },
      { key: 'energy', label: 'Oil price', score: 3, detail: 'Rising quickly, which raises costs for most companies', metric: 'WTI $87.20, up 11% in 20 days' },
    ],
  },
  picks: [
    {
      ticker: 'RKLB', conviction: 8, setupType: 'catalyst',
      sources: ['@optionshawk', '@Mr_Derivatives', 'finviz', 'RKLB catalyst search'],
      themes: ['space', 'earnings', 'contracts'], signalCount: 14, quoteVerified: true,
      price: 42.18, quoteChangePercent: 2.4, stopLoss: 38.4, target: 49.5,
      reason: 'NASA awarded a $150M hypersonic test contract last week, and three traders who do not follow each other all flagged heavy call buying for May. The stock has been sitting in a narrow band just under $42 for two weeks, which often comes before a sharp move, and earnings land Thursday after the close. If the contract pipeline speeds up, there is room to $49 against about $4 of downside.',
      bearCase: 'The stock has already climbed 35% this month, so people who bought early have a large profit to protect and may sell into any good news. The NASA contract has been public for a week, so the market has likely accounted for it already. If Thursday guidance disappoints, the nearest level buyers have defended is $38, about 10% lower.',
      riskScore: 6,
      catalystVerified: true, catalystTimeline: 'Thursday after close', catalystPricedIn: false,
      catalystDetail: 'Q2 earnings confirmed for Thursday, with analysts expecting revenue near $132M.',
      technicals: { trend: 'consolidating', rsi: 58, pctFrom52wHigh: -6, relativeVolume: 1.8 },
    },
    {
      ticker: 'MU', conviction: 7, setupType: 'breakout',
      sources: ['@aleabitoreddit', 'exa-discovery', 'finviz'],
      themes: ['ai', 'semiconductors'], signalCount: 9, quoteVerified: true,
      price: 118.4, quoteChangePercent: -0.8, stopLoss: 109, target: 134,
      reason: 'Memory prices rose for the third month running, and Micron sells into exactly that. The stock just cleared the level that capped it since March on volume nearly double normal, which suggests real buying rather than drift. Two analysts raised targets this week on the same reasoning.',
      bearCase: 'Memory has boom and bust cycles, and suppliers are adding capacity that usually arrives right as prices peak. At 74 the momentum reading is high enough that a pause would be normal. A pullback to $109 would be ordinary rather than alarming, but it is 8% away.',
      riskScore: 5,
      catalystVerified: false, catalystTimeline: 'Next month', catalystPricedIn: true,
      catalystDetail: 'Reported plans for a Japan fab expansion, which we could not confirm in company filings.',
      technicals: { trend: 'overbought-uptrend', rsi: 74, pctFrom52wHigh: -3, relativeVolume: 1.9 },
    },
    {
      ticker: 'SOFI', conviction: 5, setupType: 'squeeze',
      sources: ['@wallstengine', 'finviz'],
      themes: ['fintech'], signalCount: 4, quoteVerified: true,
      price: 8.94, quoteChangePercent: 1.1, stopLoss: null, target: null,
      reason: 'Trading in a tight range with a large share of the stock sold short, which can force those sellers to buy back quickly if it moves up. But no specific event is scheduled, so this rests on the chart alone and could sit still for weeks.',
      bearCase: 'Nothing here forces a move. Tight ranges resolve downward as often as upward, and with no event on the calendar there is no reason for the next buyer to show up this week rather than next month.',
      riskScore: 6,
      technicals: { trend: 'oversold-downtrend', rsi: 28, pctFrom52wHigh: -34, relativeVolume: 1.1 },
    },
  ],
}

// ─── Plaid ────────────────────────────────────────────────────────────────────
// Standing in for the whole Link round trip: the institution hands back four
// accounts, two of which are chequing/savings you did not ask for. That is the
// case the picker exists for, so it is the case preview mode shows.

export const PREVIEW_PLAID = {
  institutionName: 'Wealthsimple',
  itemId: 'preview-item',
  accounts: [
    { id: 'pa-chq', name: 'Cash', officialName: 'Wealthsimple Cash', type: 'depository', subtype: 'chequing', mask: '4021' },
    { id: 'pa-tfsa', name: 'TFSA', officialName: 'Wealthsimple TFSA', type: 'investment', subtype: 'tfsa', mask: '8830' },
    { id: 'pa-rrsp', name: 'RRSP', officialName: 'Wealthsimple RRSP', type: 'investment', subtype: 'rrsp', mask: '1177' },
    { id: 'pa-save', name: 'Save', officialName: 'Wealthsimple Save', type: 'depository', subtype: 'savings', mask: '5502' },
  ],
}

const plaidRow = (accountId, symbol, description, qty, price, book) => ({
  __accountId: accountId,
  SYMBOL: symbol,
  DESCRIPTION: description,
  QUANTITY: qty,
  'MARKET PRICE': price,
  'MARKET VALUE': Number((qty * price).toFixed(2)),
  'BOOK VALUE': book,
  'UNREALIZED GAIN/LOSS': Number((qty * price - book).toFixed(2)),
  'ACCOUNT TYPE': accountId === 'pa-tfsa' ? 'TFSA' : 'RRSP',
  'ACCOUNT NUMBER': accountId === 'pa-tfsa' ? '8830' : '1177',
  CURRENCY: 'CAD',
  _source: 'plaid',
  _institution: 'Wealthsimple',
})

const PLAID_ROWS = [
  plaidRow('pa-tfsa', 'VFV.TO', 'VANGUARD S&P 500 INDEX ETF', 112, 148.2, 14100),
  plaidRow('pa-tfsa', 'XEQT.TO', 'ISHARES CORE EQUITY ETF PORTFOLIO', 210, 36.44, 7300),
  plaidRow('pa-tfsa', 'BN.TO', 'BROOKFIELD CORP CLASS A', 90, 78.4, 6600),
  plaidRow('pa-rrsp', 'SHOP.TO', 'SHOPIFY INC CLASS A SUBORDINATE VOTING', 45, 152.6, 8200),
  plaidRow('pa-rrsp', 'ENB.TO', 'ENBRIDGE INC', 180, 62.15, 10400),
]

const PLAID_CASH = [
  { account: 'TFSA', accountNumber: '8830', currency: 'CAD', value: 1204.55, __accountId: 'pa-tfsa' },
  { account: 'RRSP', accountNumber: '1177', currency: 'CAD', value: 340.12, __accountId: 'pa-rrsp' },
]

/** What /api/plaid holdings would return for the chosen accounts. */
export function previewPlaidHoldings(accountIds = []) {
  const keep = new Set(accountIds)
  const strip = ({ __accountId, ...rest }) => rest
  return {
    rows: PLAID_ROWS.filter((r) => keep.has(r.__accountId)).map(strip),
    cashEntries: PLAID_CASH.filter((c) => keep.has(c.__accountId)).map(strip),
    connectedAccounts: PREVIEW_PLAID.accounts.filter((a) => keep.has(a.id)),
  }
}
