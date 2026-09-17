import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
vi.mock('../../components/CompanyLogo', () => ({ default: () => <span aria-hidden="true" /> }))
import PickCard from './PickCard'

afterEach(cleanup)

it('retains the complete research argument, uncertainty and evidence when expanded', () => {
  const pick = { ticker: 'QUIET', conviction: 7, reason: 'The full investment thesis.', price: 100, target: 120, stopLoss: 90,
    sources: ['@one', '@two', 'finviz', 'exa-discovery', 'QUIET catalyst search'], sourceCount: 4, signalCount: 0,
    themes: ['one', 'two', 'three', 'four', 'five'], quoteVerified: true,
    technicals: { trend: 'pullback', rsi: 72, relativeVolume: 1.8, pctFrom52wHigh: -12 },
    bearCase: 'The opposing case.', riskScore: 6, technicalAgreement: 'conflict', disagreementNote: 'The model and chart disagree.',
    coverageAcceleration: 'accelerating', coverageToday: 8, coveragePriorAverage: 2,
    catalystVerified: false, catalystDate: '2026-09-18', catalystTimeline: 'Next Thursday', catalystPricedIn: true,
    catalystDetail: 'A reported but unverified event.', catalystConfidence: 8,
    catalystSources: ['https://example.com/confirmed-event', 'javascript:alert(1)'],
  }
  render(<PickCard pick={pick} rank={1} />)
  fireEvent.click(screen.getByRole('button', { name: 'View research for QUIET' }))
  for (const text of ['The full investment thesis.', 'The opposing case.', 'The model and chart disagree.', "We couldn't confirm this event", 'Next Thursday', 'A reported but unverified event.', '4 independent sources', '0 mentions', '@one', '@two', 'Stock screener', 'News coverage', 'News search']) expect(screen.getByText(text)).toBeInTheDocument()
  expect(screen.getByText(/New mentions jumped to 8 today/)).toBeInTheDocument()
  expect(screen.getByText(/Market likely expects it/)).toBeInTheDocument()
  expect(screen.getByText('September 18, 2026')).toHaveAttribute('datetime', '2026-09-18')
  expect(screen.getByText(/Evidence strength · 8 \/ 10/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'example.com' })).toHaveAttribute('href', 'https://example.com/confirmed-event')
  expect(screen.queryByRole('link', { name: /javascript/ })).not.toBeInTheDocument()
  expect(screen.getByText(/About: one, two, three, four, five/)).toBeInTheDocument()
  expect(screen.getByText('$90.00')).toBeInTheDocument()
  expect(screen.getByText('$120.00')).toBeInTheDocument()
  expect(screen.getByText('Possibly overbought')).toBeInTheDocument()
  expect(screen.getByText('1.8× normal')).toBeInTheDocument()
})

it.each([null, '', 0, undefined])('does not manufacture a trade plan from an absent stop (%s)', (stopLoss) => {
  render(<PickCard pick={{ ticker: 'NONE', conviction: 6, price: 100, stopLoss, target: 120 }} rank={1} defaultOpen />)
  expect(screen.queryByText('Trade plan')).not.toBeInTheDocument()
  expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
})

it('shows risk without a bear-case paragraph and technical data without a trend', () => {
  render(<PickCard pick={{ ticker: 'PARTIAL', conviction: 6, riskScore: 8, technicals: { relativeVolume: 2 } }} rank={1} defaultOpen />)
  expect(screen.getByText('Risk')).toBeInTheDocument()
  expect(screen.getByText('A bear case was not included in this run.')).toBeInTheDocument()
  expect(screen.getByText('2× normal')).toBeInTheDocument()
  expect(screen.getByText('Price unavailable')).toBeInTheDocument()
})
