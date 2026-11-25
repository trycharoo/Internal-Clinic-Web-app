import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { storageKeys } from './test/fixtures'
import { createUser, demoAccounts, openChart, renderDemo, savedPatients, savedQueue, seedBaseStorage, signIntoDemo } from './test/helpers'

beforeEach(() => {
  seedBaseStorage()
})

describe('demo controls and session preservation', () => {
  it('returns from the synthetic workspace to sign-in without granting a selected role access', async () => {
    const user = createUser()
    renderDemo()
    await user.click(screen.getByRole('button', { name: 'Log in as' }))
    expect(screen.getByRole('button', { name: 'Explore demo workspace' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Patient' }))
    expect(screen.getByRole('heading', { name: 'Your care starts here.' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Search patients' })).not.toBeInTheDocument()
    expect(savedPatients()).toHaveLength(2)
  })

  it('preserves unsaved visit and prescription drafts when viewing sign-in and returning to the demo', async () => {
    const user = createUser()
    renderDemo()
    await openChart(user)

    await user.click(screen.getAllByRole('button', { name: 'Start visit' })[0])
    await user.type(screen.getByPlaceholderText('e.g. Blood pressure, temperature, exam findings'), 'Synthetic observed signs')
    await user.type(screen.getByPlaceholderText('Add a working diagnosis'), 'Synthetic assessment draft')

    await user.click(screen.getByRole('button', { name: /^Prescriptions\s*\d+/ }))
    await user.type(screen.getByRole('textbox', { name: /Medication name/ }), 'Synthetic draft medication')

    await user.click(screen.getByRole('button', { name: 'Log in as' }))
    expect(screen.queryByRole('textbox', { name: 'Search patients' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Explore demo workspace' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Alice Santos' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Medication name/ })).toHaveValue('Synthetic draft medication')

    await user.click(screen.getByRole('button', { name: /^Visit notes/ }))
    expect(screen.getByPlaceholderText('e.g. Blood pressure, temperature, exam findings')).toHaveValue('Synthetic observed signs')
    expect(screen.getByPlaceholderText('Add a working diagnosis')).toHaveValue('Synthetic assessment draft')
    expect(savedPatients()[0].records).toEqual([])
    expect(savedPatients()[0].prescriptions).toEqual([])
  })

  it('resets changed clinic records, online dates, and queue state to the repeatable synthetic scenario', async () => {
    localStorage.setItem(storageKeys.onlineDates, JSON.stringify(['2026-11-10']))
    localStorage.setItem(storageKeys.queue, JSON.stringify({
      date: new Date().toISOString().slice(0, 10),
      token: 'old-token',
      isOpen: true,
      entries: [{ id: 'q-old', number: '001', name: 'Test', phone: '0917', joinedAt: new Date().toISOString(), status: 'waiting' }],
    }))
    const user = createUser()
    renderDemo()
    await user.click(screen.getByRole('button', { name: 'Reset demo' }))
    expect(await screen.findByRole('heading', { name: /Good morning, Maya/ })).toBeInTheDocument()
    expect(screen.getByText('Paolo Mendoza')).toBeInTheDocument()
    expect(savedPatients()).toHaveLength(5)
    expect(savedQueue()).toBeNull()
    expect(JSON.parse(localStorage.getItem(storageKeys.onlineDates)!)).toEqual([])
  })
})

describe('role-specific sign-in forms and routes', () => {
  it.each(['/login', '/', '/demo/doctor', '/demo/attendant', '/demo/patient'])('normalizes fresh %s access to /login without exposing workspaces', (path) => {
    window.history.replaceState({}, '', path)
    render(<App />)
    expect(window.location.pathname).toBe('/login')
    expect(screen.getByRole('heading', { name: 'Welcome back, doctor.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Doctor' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Email address', { exact: true })).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText('Password', { exact: true })).toHaveAttribute('type', 'password')
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Reception workspace' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Welcome, Sofia.' })).not.toBeInTheDocument()
  })

  it('validates fields, toggles password visibility, shows help, and clears state on role switch', async () => {
    const user = createUser()
    render(<App />)
    const email = screen.getByLabelText('Email address', { exact: true })
    const password = screen.getByLabelText('Password', { exact: true })
    const submit = screen.getByRole('button', { name: 'Sign in as Doctor' })

    await user.click(submit)
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(password).toHaveAttribute('aria-invalid', 'true')

    await user.type(email, 'invalid-address')
    await user.type(password, '   ')
    await user.click(submit)
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(password).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(password).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(password).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: 'Forgot password?' }))
    expect(screen.getByRole('status')).toHaveTextContent(/not|unavailable|connect/i)

    await user.click(screen.getByRole('button', { name: 'Show password' }))
    await user.click(screen.getByRole('button', { name: 'Patient' }))
    expect(email).toHaveValue('')
    expect(password).toHaveValue('')
    expect(password).toHaveAttribute('type', 'password')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sign in as Patient' }))
    expect(email).toHaveAttribute('aria-invalid', 'true')
    await user.click(screen.getByRole('button', { name: 'Attendant / Secretary' }))
    expect(email).not.toHaveAttribute('aria-invalid', 'true')
    expect(password).not.toHaveAttribute('aria-invalid', 'true')
    await user.click(screen.getByRole('button', { name: 'Need access?' }))
    expect(screen.getByRole('status')).toHaveTextContent(/clinic|administrator/i)
  })

  it('rejects unknown credentials and role mismatches without leaving login or persisting credentials', async () => {
    const user = createUser()
    render(<App />)
    const records = localStorage.getItem(storageKeys.patients)

    await user.click(screen.getByRole('button', { name: 'Patient' }))
    await user.type(screen.getByLabelText('Email address', { exact: true }), demoAccounts.Doctor.email)
    await user.type(screen.getByLabelText('Password', { exact: true }), demoAccounts.Doctor.password)
    await user.click(screen.getByRole('button', { name: 'Sign in as Patient' }))

    expect(screen.getByRole('alert')).toHaveTextContent('These demo credentials do not match the selected role.')
    expect(window.location.pathname).toBe('/login')
    expect(screen.getByLabelText('Password')).toHaveValue('')
    expect(screen.getByLabelText('Email address')).toHaveValue(demoAccounts.Doctor.email)

    await user.clear(screen.getByLabelText('Email address'))
    await user.type(screen.getByLabelText('Email address'), '  synthetic@example.test  ')
    await user.type(screen.getByLabelText('Password'), 'Synthetic-only-password')
    await user.click(screen.getByRole('button', { name: 'Sign in as Patient' }))

    expect(screen.getByRole('alert')).toHaveTextContent('These demo credentials do not match the selected role.')
    expect(localStorage.getItem(storageKeys.patients)).toBe(records)
    expect(Object.values(localStorage).join(' ')).not.toContain('Synthetic-only-password')
    expect(Object.values(localStorage).join(' ')).not.toContain('synthetic@example.test')
    expect(sessionStorage.length).toBe(0)
  })

  it.each(['Doctor', 'Attendant', 'Patient'] as const)('signs into %s via demo credentials, hides them from storage, and clears session on Log in as', async (role) => {
    const user = createUser()
    render(<App />)
    const records = localStorage.getItem(storageKeys.patients)

    await user.click(screen.getByRole('button', { name: role === 'Attendant' ? 'Attendant / Secretary' : role }))
    await user.click(screen.getByText('Demo credentials', { exact: true }))
    expect(screen.getByText(demoAccounts[role].email, { exact: true })).toBeVisible()
    expect(screen.getByText(demoAccounts[role].password, { exact: true })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Use demo credentials' }))
    expect(window.location.pathname).toBe('/login')

    await user.click(screen.getByRole('button', { name: `Sign in as ${role}` }))
    expect(window.location.pathname).toBe(demoAccounts[role].path)
    expect(screen.getByRole('heading', { name: demoAccounts[role].heading })).toBeInTheDocument()
    expect(localStorage.getItem(storageKeys.patients)).toBe(records)

    const persisted = Object.values(localStorage).join(' ')
    for (const account of Object.values(demoAccounts)) {
      expect(persisted).not.toContain(account.email)
      expect(persisted).not.toContain(account.password)
    }
    expect(sessionStorage.length).toBe(0)

    await user.click(screen.getByRole('button', { name: 'Log in as' }))
    expect(window.location.pathname).toBe('/login')
    expect(screen.getByLabelText('Password')).toHaveValue('')
    window.history.pushState({}, '', demoAccounts[role].path)
    fireEvent.popState(window)
    expect(window.location.pathname).toBe('/login')
    expect(screen.queryByRole('heading', { name: demoAccounts[role].heading })).not.toBeInTheDocument()
  })

  it('keeps a same-role history route, clears session on cross-role history tampering, and resets on remount', async () => {
    const user = createUser()
    const view = render(<App />)
    await signIntoDemo(user, 'Patient')

    window.history.pushState({}, '', '/demo/patient')
    fireEvent.popState(window)
    expect(window.location.pathname).toBe('/demo/patient')
    expect(screen.getByRole('heading', { name: 'Welcome, Sofia.' })).toBeInTheDocument()

    window.history.pushState({}, '', '/demo/doctor')
    fireEvent.popState(window)
    expect(window.location.pathname).toBe('/login')
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument()

    window.history.pushState({}, '', '/demo/patient')
    fireEvent.popState(window)
    expect(window.location.pathname).toBe('/login')
    expect(screen.queryByRole('heading', { name: 'Welcome, Sofia.' })).not.toBeInTheDocument()

    await signIntoDemo(user, 'Doctor')
    const records = localStorage.getItem(storageKeys.patients)
    view.unmount()

    render(<App />)
    expect(window.location.pathname).toBe('/login')
    expect(screen.getByLabelText('Email address')).toHaveValue('')
    expect(screen.getByLabelText('Password')).toHaveValue('')
    expect(localStorage.getItem(storageKeys.patients)).toBe(records)
  })

  it('enforces role UI boundaries for Patient and Attendant and keeps public check-in isolated', async () => {
    const today = new Date()
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    localStorage.setItem(storageKeys.queue, JSON.stringify({ date, token: 'test-daily-token', isOpen: true, entries: [] }))

    const user = createUser()
    const view = render(<App />)
    await signIntoDemo(user, 'Patient')
    expect(screen.queryByText('Alice Santos')).not.toBeInTheDocument()
    expect(screen.queryByText('Bea Cruz')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Search patients' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /New walk-in|Book appointment|Record triage|Prescriptions|Clinical notes/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open patient check-in' }))
    expect(screen.getByRole('heading', { name: 'Join today’s queue' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to clinic' }))
    expect(window.location.pathname).toBe('/demo/patient')
    expect(screen.getByRole('heading', { name: 'Welcome, Sofia.' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Log in as' }))
    await signIntoDemo(user, 'Attendant')
    expect(screen.getByRole('button', { name: 'New walk-in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Book appointment' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Clinical notes|Prescriptions|Start consultation|Generate today’s QR|View history/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Search patients' })).not.toBeInTheDocument()
    view.unmount()

    window.history.replaceState({}, '', '/?queue=test-daily-token')
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Join today’s queue' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Password', { exact: true })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to clinic' }))
    expect(screen.getByRole('heading', { name: 'Welcome back, doctor.' })).toBeInTheDocument()
    expect(window.location.search).toBe('')
  })
})

describe('sign-in cover preview', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  function mockCoverImages() {
    const pending: HTMLImageElement[] = []
    const BrowserURL = globalThis.URL
    let number = 0
    class PreviewURL extends BrowserURL {
      static createObjectURL = vi.fn(() => `blob:synthetic-cover-${++number}`)
      static revokeObjectURL = vi.fn()
    }
    vi.stubGlobal('URL', PreviewURL)
    vi.spyOn(window, 'Image').mockImplementation(function () {
      const image = document.createElement('img')
      pending.push(image)
      return image
    })
    return { pending, create: PreviewURL.createObjectURL, revoke: PreviewURL.revokeObjectURL }
  }

  function hero() {
    return document.querySelector<HTMLImageElement>('.login-hero-image')!
  }

  it('replaces, retains across navigation, revokes on replace/reset/unmount, and preserves typed credentials', async () => {
    const { pending, revoke } = mockCoverImages()
    const user = createUser()
    const view = render(<App />)
    const storage = { ...localStorage }

    expect(hero()).toHaveAttribute('src', '/images/clinic-hero.jpg')
    expect(screen.queryByRole('button', { name: 'Reset cover' })).not.toBeInTheDocument()

    const chooser = screen.getByLabelText('Choose a cover image')
    await user.type(screen.getByLabelText('Email address'), 'synthetic@example.test')
    await user.type(screen.getByLabelText('Password'), 'Synthetic-only-password')
    await user.upload(chooser, new File([new Uint8Array(5 * 1024 * 1024)], 'boundary.webp', { type: 'image/webp' }))
    fireEvent.load(pending[0])
    expect(hero()).toHaveAttribute('src', 'blob:synthetic-cover-1')
    expect(screen.getByRole('status')).toHaveTextContent(/Cover updated/)

    await user.click(screen.getByRole('button', { name: 'Patient' }))
    expect(hero()).toHaveAttribute('src', 'blob:synthetic-cover-1')
    await user.click(screen.getByRole('button', { name: 'Explore demo workspace' }))
    expect(revoke).not.toHaveBeenCalledWith('blob:synthetic-cover-1')
    await user.click(screen.getByRole('button', { name: 'Log in as' }))
    expect(hero()).toHaveAttribute('src', 'blob:synthetic-cover-1')

    await user.type(screen.getByLabelText('Email address'), 'synthetic@example.test')
    await user.type(screen.getByLabelText('Password'), 'Synthetic-only-password')
    await user.upload(screen.getByLabelText('Choose a cover image'), new File(['replacement photo'], 'replacement.png', { type: 'image/png' }))
    fireEvent.load(pending[1])
    expect(hero()).toHaveAttribute('src', 'blob:synthetic-cover-2')
    expect(revoke).toHaveBeenCalledWith('blob:synthetic-cover-1')

    await user.click(screen.getByRole('button', { name: 'Reset cover' }))
    expect(hero()).toHaveAttribute('src', '/images/clinic-hero.jpg')
    expect(revoke).toHaveBeenCalledWith('blob:synthetic-cover-2')
    expect(screen.getByLabelText('Email address')).toHaveValue('synthetic@example.test')
    expect(screen.getByLabelText('Password')).toHaveValue('Synthetic-only-password')
    expect({ ...localStorage }).toEqual(storage)
    expect(sessionStorage.length).toBe(0)

    await user.upload(screen.getByLabelText('Choose a cover image'), new File(['third'], 'third.jpg', { type: 'image/jpeg' }))
    fireEvent.load(pending[2])
    view.unmount()
    expect(revoke).toHaveBeenCalledWith('blob:synthetic-cover-3')
    render(<App />)
    expect(hero()).toHaveAttribute('src', '/images/clinic-hero.jpg')
  })

  it('rejects unsupported, oversized, corrupt, stale-decoded, and cancelled cover selections safely', async () => {
    const { pending, create, revoke } = mockCoverImages()
    const user = createUser({ applyAccept: false })
    render(<App />)
    const chooser = screen.getByLabelText('Choose a cover image')

    for (const file of [
      new File(['text'], 'cover.txt', { type: 'text/plain' }),
      new File(['<svg />'], 'cover.svg', { type: 'image/svg+xml' }),
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.jpg', { type: 'image/jpeg' }),
    ]) {
      await user.upload(chooser, file)
      expect(screen.getByRole('alert')).toHaveTextContent(/image|PNG|JPG|JPEG|5 MB|5MB/i)
      expect(hero()).toHaveAttribute('src', '/images/clinic-hero.jpg')
      expect(create).not.toHaveBeenCalled()
    }

    await user.upload(chooser, new File(['first'], 'first.jpg', { type: 'image/jpeg' }))
    await user.upload(chooser, new File(['second'], 'second.jpg', { type: 'image/jpeg' }))
    fireEvent.load(pending[1])
    fireEvent.load(pending[0])
    expect(hero()).toHaveAttribute('src', 'blob:synthetic-cover-2')
    expect(revoke).toHaveBeenCalledWith('blob:synthetic-cover-1')

    await user.upload(chooser, new File(['corrupt'], 'corrupt.png', { type: 'image/png' }))
    fireEvent.error(pending[2])
    expect(screen.getByRole('alert')).toHaveTextContent(/image|read|load/i)
    expect(hero()).toHaveAttribute('src', 'blob:synthetic-cover-2')
    expect(revoke).toHaveBeenCalledWith('blob:synthetic-cover-3')

    fireEvent.change(chooser, { target: { files: [] } })
    expect(create).toHaveBeenCalledTimes(3)
    expect(hero()).toHaveAttribute('src', 'blob:synthetic-cover-2')
  })
})
