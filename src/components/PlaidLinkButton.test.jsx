import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
const mocks = vi.hoisted(() => ({ call: vi.fn(), open: vi.fn(), config: null }))
vi.mock('../preview/mockMode', () => ({ IS_PREVIEW: false, PREVIEW_PLAID: {} }))
vi.mock('../utils/plaidClient', () => ({ callPlaid: mocks.call }))
vi.mock('react-plaid-link', () => ({ usePlaidLink: (config) => { mocks.config = config; return { open: mocks.open, ready: true, error: null } } }))
import PlaidLinkButton from './PlaidLinkButton'

describe('Plaid connection recovery', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.call.mockResolvedValue({ ok: true, json: async () => ({ link_token: 'test-link' }) }) })
  it('retries a failed token request and opens Link only once it is ready', async () => {
    mocks.call.mockRejectedValueOnce(new Error('offline'))
    const onLinkOpenChange = vi.fn()
    render(<PlaidLinkButton userId="user" onLinkOpenChange={onLinkOpenChange} />)
    fireEvent.click(await screen.findByRole('button', { name: /Try again/ }))
    const button = await screen.findByRole('button', { name: 'Continue with Plaid' })
    fireEvent.click(button)
    expect(mocks.open).toHaveBeenCalledOnce()
    expect(onLinkOpenChange).toHaveBeenCalledWith(true)
    expect(mocks.call).toHaveBeenCalledTimes(2)
  })
  it('renews the single-use token after the hosted flow exits', async () => {
    const onLinkOpenChange = vi.fn()
    render(<PlaidLinkButton userId="user" onLinkOpenChange={onLinkOpenChange} />)
    await screen.findByRole('button', { name: 'Continue with Plaid' })
    const { act } = await import('@testing-library/react')
    act(() => mocks.config.onExit(null))
    await waitFor(() => expect(mocks.call).toHaveBeenCalledTimes(2))
    expect(onLinkOpenChange).toHaveBeenCalledWith(false)
  })
})
