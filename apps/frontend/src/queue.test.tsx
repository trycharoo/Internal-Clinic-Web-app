import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { dateKey, type QueueEntry } from './clinic'
import { patient, queue, storageKeys } from './test/fixtures'
import { createUser, fillCheckIn, joinPreview, openQueue, renderDemo, savedPatients, savedQueue, secondPatient, seedBaseStorage, signIntoDemo } from './test/helpers'

beforeEach(() => {
  seedBaseStorage()
})

describe('daily walk-in queue and check-in boundaries', () => {
  it('links check-in, consultation, prescription, and history to one encounter without triage', async () => {
    const user = createUser()
    localStorage.setItem(storageKeys.patients, JSON.stringify([patient({ notes: 'Existing live-saved interview draft.' }), secondPatient()]))
    renderDemo()
    await openQueue(user)
    await user.click(screen.getByRole('button', { name: 'Generate today’s QR' }))
    await screen.findByAltText('QR code for today’s patient check-in')

    await joinPreview(user, 'Alice Santos', '0917-123-4567')
    expect(screen.getByRole('status')).toHaveTextContent('001')
    expect(savedPatients().find((item) => item.name === 'Alice Santos')).toMatchObject({ allergyStatus: 'unknown', allergy: 'Not recorded' })
    await user.click(screen.getByRole('button', { name: 'Back to clinic' }))

    await joinPreview(user, 'alice santos', '09171234567')
    expect(screen.getByRole('status')).toHaveTextContent('001')
    expect(savedQueue().entries).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Back to clinic' }))

    await joinPreview(user, 'Unknown Sex Demo', '0917-987-6543', 'Unknown')
    expect(screen.getByRole('status')).toHaveTextContent('002')
    expect(savedPatients().find((item) => item.name === 'Unknown Sex Demo')).toMatchObject({ sex: 'Unknown', allergyStatus: 'unknown', allergy: 'Not recorded' })
    await user.click(screen.getByRole('button', { name: 'Back to clinic' }))

    expect(savedQueue().entries.map((entry) => entry.stage)).toEqual(['ready', 'ready'])
    await user.click(screen.getAllByRole('button', { name: 'Start consultation' })[0])
    const consultation = screen.getByRole('dialog', { name: 'Complete visit' })
    await user.type(within(consultation).getByRole('textbox', { name: /Assessment \/ diagnosis/ }), 'Tension headache')
    await user.type(within(consultation).getByRole('textbox', { name: /Consultation notes/ }), 'Rest and hydration discussed')
    await user.click(within(consultation).getByRole('checkbox', { name: /reviewed the allergy information/ }))
    await user.click(within(consultation).getByText('Add prescription to this encounter (optional draft)'))
    await user.type(within(consultation).getByRole('textbox', { name: 'Medication' }), 'Demo analgesic')
    await user.type(within(consultation).getByRole('textbox', { name: 'Directions' }), 'Take as directed in this synthetic demo')
    expect(within(consultation).getByRole('button', { name: 'Save visit to patient history' })).toBeDisabled()

    await user.selectOptions(within(consultation).getByRole('combobox', { name: /Confirmed allergy status/ }), 'none')
    await user.click(within(consultation).getByRole('button', { name: 'Save visit to patient history' }))
    expect(savedQueue().entries.map((entry) => entry.stage)).toEqual(['complete', 'ready'])

    const linkedPatient = savedPatients().find((item) => item.id === savedQueue().entries[0].patientId)!
    expect(linkedPatient).toMatchObject({ allergyStatus: 'none', allergy: 'No known allergies', notes: '' })
    expect(linkedPatient.records[0]).toMatchObject({ diagnosis: 'Tension headache', notes: 'Existing live-saved interview draft.\n\nRest and hydration discussed', encounterId: savedQueue().entries[0].id })
    expect(linkedPatient.prescriptions[0]).toMatchObject({ medication: 'Demo analgesic', encounterId: savedQueue().entries[0].id })

    await user.click(screen.getByRole('button', { name: 'View history' }))
    expect(screen.getByRole('heading', { level: 1, name: linkedPatient.name })).toBeInTheDocument()
    expect(screen.getByText(/Tension headache/)).toBeInTheDocument()
  })

  it('enforces one active consultation and returns a set-aside or called patient to ready waiting', async () => {
    const readyEntry = (id: string, number: string, name: string, patientId: string) => ({
      id, number, name, phone: '09171234567', joinedAt: new Date().toISOString(), status: 'waiting' as const,
      patientId, birthDate: '1990-05-10', reportedAllergyStatus: 'none' as const, reportedAllergy: '', stage: 'ready' as const,
    })
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ entries: [
      { ...readyEntry('q-1', '001', 'Alice Santos', 'patient-a'), status: 'called' as const },
      readyEntry('q-2', '002', 'Bea Cruz', 'patient-b'),
    ] })))
    const user = createUser()
    renderDemo()
    await openQueue(user)

    await user.click(screen.getAllByRole('button', { name: 'Start consultation' })[0])
    expect(screen.getByRole('dialog', { name: 'Complete visit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start consultation' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Continue later' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(savedQueue().entries[0]).toMatchObject({ status: 'waiting', stage: 'ready' })
    expect(screen.getByRole('button', { name: 'Call next' })).toBeEnabled()
    screen.getAllByRole('button', { name: 'Start consultation' }).forEach((button) => expect(button).toBeEnabled())
  })

  it('rejects invalid check-in inputs, expired/wrong tokens, and midnight rollover without issuing tickets', async () => {
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ date: '2000-01-01' })))
    window.history.replaceState({}, '', '/?queue=test-daily-token')
    const view = renderDemo()
    expect(screen.getByRole('alert')).toHaveTextContent('This check-in link isn’t connected')
    expect(screen.queryByRole('button', { name: 'Get my queue number' })).not.toBeInTheDocument()
    view.unmount()

    localStorage.setItem(storageKeys.queue, JSON.stringify(queue()))
    window.history.replaceState({}, '', '/?queue=not-the-token')
    const wrongView = renderDemo()
    expect(screen.getByRole('alert')).toHaveTextContent('This check-in link isn’t connected')
    wrongView.unmount()

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-09T23:59:00'))
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue()))
    window.history.replaceState({}, '', '/?queue=test-daily-token')
    const user = createUser()
    renderDemo()

    await user.type(screen.getByRole('textbox', { name: /Full name/ }), 'Late arrival')
    await user.type(screen.getByRole('textbox', { name: /Phone number/ }), 'no-digits')
    fireEvent.change(document.querySelector<HTMLInputElement>('input[type="date"]')!, { target: { value: '1990-05-10' } })
    await user.selectOptions(screen.getByRole('combobox', { name: /Sex/ }), 'Female')
    await user.selectOptions(screen.getByRole('combobox', { name: /Allergy status/ }), 'none')
    fireEvent.submit(screen.getByRole('button', { name: 'Get my queue number' }).closest('form')!)
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your name, phone, valid date of birth, sex, and allergy details when known.')
    expect(savedQueue().entries).toHaveLength(0)
    expect(savedPatients()).toHaveLength(2)

    await user.clear(screen.getByRole('textbox', { name: /Phone number/ }))
    await user.type(screen.getByRole('textbox', { name: /Phone number/ }), '09171234567')
    vi.setSystemTime(new Date('2026-11-10T00:01:00'))
    await user.click(screen.getByRole('button', { name: 'Get my queue number' }))
    expect(screen.getByRole('alert')).toHaveTextContent('This check-in link isn’t connected')
    expect(savedQueue().entries).toHaveLength(0)
  })

  it('syncs the clinic queue on valid storage events and ignores malformed payloads', async () => {
    const user = createUser()
    renderDemo()
    await openQueue(user)
    fireEvent(window, new StorageEvent('storage', { key: storageKeys.queue, newValue: JSON.stringify(queue({ entries: [{ id: 'entry-1', number: '001', name: 'Test arrival', phone: '1234', joinedAt: new Date().toISOString(), status: 'waiting' }] })) }))
    expect(screen.getByText('Test arrival')).toBeInTheDocument()
    fireEvent(window, new StorageEvent('storage', { key: storageKeys.queue, newValue: JSON.stringify({ date: dateKey(new Date()), entries: null }) }))
    expect(screen.getByText('No patients in line yet')).toBeInTheDocument()
  })
})

describe('SRS INT-01 and QUE-01: intake controls, QR rotation, and closing times', () => {
  it('pauses/resumes intake, rotates QR while keeping tickets and pause state, and keeps current QR on cancel', async () => {
    const user = createUser()
    const view = renderDemo()
    await openQueue(user)
    await user.click(screen.getByRole('button', { name: 'Generate today’s QR' }))
    await joinPreview(user, 'Alice Santos', '09171234567')
    await user.click(screen.getByRole('button', { name: 'Back to clinic' }))
    const previousToken = savedQueue().token

    await user.click(screen.getByRole('button', { name: 'Pause check-in' }))
    await user.click(screen.getByRole('button', { name: 'Preview patient check-in' }))
    expect(screen.getByRole('status')).toHaveTextContent('Check-in is paused')
    expect(screen.queryByRole('button', { name: 'Get my queue number' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to clinic' }))

    await user.click(screen.getByRole('button', { name: 'Rotate QR' }))
    await user.click(screen.getByRole('button', { name: 'Keep current QR' }))
    expect(savedQueue().token).toBe(previousToken)

    await user.click(screen.getByRole('button', { name: 'Rotate QR' }))
    await user.click(screen.getByRole('button', { name: 'Replace QR code' }))
    const rotated = savedQueue()
    expect(rotated.token).not.toBe(previousToken)
    expect(rotated.isOpen).toBe(false)
    expect(rotated.entries).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Reopen check-in' }))
    await user.click(screen.getByRole('button', { name: 'Preview patient check-in' }))
    expect(screen.getByRole('button', { name: 'Get my queue number' })).toBeEnabled()
    view.unmount()

    window.history.replaceState({}, '', `/?queue=${previousToken}`)
    renderDemo()
    expect(screen.getByRole('alert')).toHaveTextContent('This check-in link isn’t connected')
  })

  it('closes on the clock, lets the doctor extend closing time, and displays expired state at reception', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date(2026, 10, 9, 16, 50, 0))
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ closesAt: '17:00' })))
    const view = renderDemo()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', { name: /^Daily queue/ }))
    expect(screen.getByText('Accepting check-ins')).toBeInTheDocument()

    act(() => {
      vi.setSystemTime(new Date(2026, 10, 9, 17, 0, 30))
      vi.advanceTimersByTime(30_000)
    })
    expect(screen.getByText('Closed at 17:00')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: 'Closing time' }), { target: { value: '18:00' } })
    expect(screen.getByText('Accepting check-ins')).toBeInTheDocument()
    expect(savedQueue().closesAt).toBe('18:00')

    act(() => {
      vi.setSystemTime(new Date(2026, 10, 9, 18, 5, 0))
      vi.advanceTimersByTime(30_000)
    })
    expect(screen.getByText('Closed at 18:00')).toBeInTheDocument()
    view.unmount()

    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 9, 18, 5, 0))
    const user = createUser()
    render(<App />)
    await signIntoDemo(user, 'Attendant')
    expect(screen.getByText('Closed at 18:00')).toBeInTheDocument()
    expect(screen.getByText(/Only the doctor can change the closing time/)).toBeInTheDocument()
  })

  it('ends and reopens intake accurately across open, paused, and expired states and restricts Attendant controls', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 9, 17, 30, 0))
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ ended: true, closesAt: '17:00' })))
    const user = createUser()
    render(<App />)
    await signIntoDemo(user, 'Attendant')
    expect(screen.getByText('Intake is closed for today. Only the doctor can reopen it.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Resume check-in|Pause check-in|Reopen intake/ })).not.toBeInTheDocument()
    cleanup()

    renderDemo()
    await openQueue(user)
    await user.click(screen.getByRole('button', { name: 'Reopen intake' }))
    expect(screen.getByText(/Intake reopened, but the closing time has passed/)).toBeInTheDocument()
    expect(savedQueue().ended).toBe(false)
    cleanup()

    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ ended: true, isOpen: false })))
    renderDemo()
    await openQueue(user)
    await user.click(screen.getByRole('button', { name: 'Reopen intake' }))
    expect(screen.getByText(/Intake reopened, but check-in is still paused/)).toBeInTheDocument()
    cleanup()

    vi.setSystemTime(new Date(2026, 10, 9, 9, 0, 0))
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue()))
    renderDemo()
    await openQueue(user)
    await user.click(screen.getByRole('button', { name: 'End today’s intake' }))
    await user.click(screen.getByRole('button', { name: 'End intake for today' }))
    await user.click(screen.getByRole('button', { name: 'Preview patient check-in' }))
    expect(screen.getByRole('status')).toHaveTextContent('Check-in for today has ended')
    await user.click(screen.getByRole('button', { name: 'Back to clinic' }))
    await user.click(screen.getByRole('button', { name: 'Reopen intake' }))
    await user.click(screen.getByRole('button', { name: 'Preview patient check-in' }))
    expect(screen.getByRole('button', { name: 'Get my queue number' })).toBeEnabled()
  })

  it('carries check-in reason and symptoms to the queue, optional triage, and consultation', async () => {
    const user = createUser()
    renderDemo()
    await openQueue(user)
    await user.click(screen.getByRole('button', { name: 'Generate today’s QR' }))
    await user.click(screen.getByRole('button', { name: 'Preview patient check-in' }))
    await fillCheckIn(user, 'Alice Santos', 'Headache', 'Throbbing pain')
    await user.click(screen.getByRole('button', { name: 'Get my queue number' }))
    expect(savedQueue().entries[0]).toMatchObject({ reportedReason: 'Headache', reportedSymptoms: 'Throbbing pain' })
    await user.click(screen.getByRole('button', { name: 'Back to clinic' }))

    expect(screen.getByText(/Reported: Headache — Throbbing pain/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start consultation' }))
    const consult = within(screen.getByRole('dialog', { name: 'Complete visit' }))
    expect(consult.getByText('Headache')).toBeInTheDocument()
    expect(consult.getByRole('textbox', { name: 'Symptoms' })).toHaveValue('Throbbing pain')
    await user.click(consult.getByRole('button', { name: 'Continue later' }))
    cleanup()

    render(<App />)
    await signIntoDemo(user, 'Attendant')
    await user.click(screen.getByRole('button', { name: 'Record triage' }))
    const triage = within(screen.getByRole('dialog', { name: 'Record triage' }))
    expect(triage.getByLabelText(/Chief complaint/)).toHaveValue('Headache')
    await user.clear(triage.getByLabelText(/Chief complaint/))
    await user.type(triage.getByLabelText(/Blood pressure/), '120/80')
    await user.selectOptions(triage.getByRole('combobox', { name: /Confirmed allergy status/ }), 'none')
    await user.click(triage.getByRole('checkbox', { name: /confirmed their identity/ }))
    await user.click(triage.getByRole('button', { name: 'Save triage & hand off' }))
    expect(savedQueue().entries[0].triage).toMatchObject({ complaint: '', bloodPressure: '120/80' })
  })
})

describe('SRS ALL-01 and TRI-01: allergy reconciliation across triage and consultation', () => {
  const triageDone = { complaint: 'Headache', notes: '', bloodPressure: '', weight: '', temperature: '' }
  const allergyEntry = (overrides: Record<string, unknown> = {}) => ({
    id: 'q-allergy', number: '001', name: 'Alice Santos', phone: '09171234567', joinedAt: new Date().toISOString(),
    status: 'waiting' as const, patientId: 'patient-a', stage: 'triage' as const, reportedAllergyStatus: 'none' as const, reportedAllergy: '', ...overrides,
  })
  const documentedPatient = () => [patient({ allergy: 'Penicillin', allergyStatus: 'known' }), secondPatient()]

  async function recordTriage(user: ReturnType<typeof createUser>, status: string, details?: string) {
    await user.click(screen.getByRole('button', { name: 'Record triage' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Record triage' }))
    await user.type(dialog.getByLabelText(/Chief complaint/), 'Headache')
    await user.selectOptions(dialog.getByRole('combobox', { name: /Confirmed allergy status/ }), status)
    if (details) await user.type(dialog.getByRole('textbox', { name: /Confirmed allergies/ }), details)
    await user.click(dialog.getByRole('checkbox', { name: /verified the allergy status/ }))
    await user.click(dialog.getByRole('button', { name: 'Save triage & hand off' }))
  }

  it('requires details for known allergies at triage, merges new ones, and flags discrepancies for the doctor', async () => {
    localStorage.setItem(storageKeys.patients, JSON.stringify(documentedPatient()))
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ entries: [allergyEntry()] })))
    const user = createUser()
    const view = render(<App />)
    await signIntoDemo(user, 'Attendant')
    await recordTriage(user, 'known', '   ')
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('Enter the confirmed allergy details')
    await user.clear(within(screen.getByRole('dialog')).getByRole('textbox', { name: /Confirmed allergies/ }))
    await user.type(within(screen.getByRole('dialog')).getByRole('textbox', { name: /Confirmed allergies/ }), 'Latex, penicillin')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save triage & hand off' }))
    expect(savedPatients().find((item) => item.id === 'patient-a')).toMatchObject({ allergyStatus: 'known', allergy: 'Penicillin, Latex' })
    view.unmount()

    localStorage.setItem(storageKeys.patients, JSON.stringify(documentedPatient()))
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ entries: [allergyEntry()] })))
    render(<App />)
    await signIntoDemo(user, 'Attendant')
    await recordTriage(user, 'none')
    expect(savedPatients().find((item) => item.id === 'patient-a')).toMatchObject({ allergyStatus: 'known', allergy: 'Penicillin' })
    expect(savedQueue().entries[0]).toMatchObject({ stage: 'ready', allergyDiscrepancy: { reportedStatus: 'none', documentedAllergy: 'Penicillin' } })
  })

  it('requires doctor keep/remove decision with reason on conflict, skips confirmation when triaged, and supports non-FIFO start', async () => {
    localStorage.setItem(storageKeys.patients, JSON.stringify(documentedPatient()))
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ entries: [
      allergyEntry({ id: 'q-1', stage: 'ready', triage: triageDone, allergyDiscrepancy: { reportedStatus: 'none', documentedAllergy: 'Penicillin' } }),
      allergyEntry({ id: 'q-2', number: '002', name: 'Bea Cruz', patientId: 'patient-b', stage: 'ready', reportedAllergyStatus: 'known', reportedAllergy: 'Latex', reportedReason: 'Chest tightness' }),
    ] })))
    const user = createUser()
    renderDemo()
    await openQueue(user)

    await user.click(screen.getAllByRole('button', { name: 'Start consultation' })[1])
    const consultDialog = screen.getByRole('dialog', { name: 'Complete visit' })
    expect(consultDialog).toHaveTextContent('Bea Cruz')
    let dialog = within(consultDialog)
    await user.type(dialog.getByRole('textbox', { name: /Assessment \/ diagnosis/ }), 'Chest review')
    await user.type(dialog.getByRole('textbox', { name: /Consultation notes/ }), 'Checked')
    await user.click(dialog.getByRole('checkbox', { name: /reviewed the allergy information/ }))
    await user.selectOptions(dialog.getByRole('combobox', { name: /Confirmed allergy status/ }), 'known')
    await user.type(dialog.getByRole('textbox', { name: /Confirmed allergies/ }), 'Latex')
    await user.click(dialog.getByRole('button', { name: 'Save visit to patient history' }))
    expect(savedPatients().find((item) => item.id === 'patient-b')).toMatchObject({ allergyStatus: 'known', allergy: 'Latex' })

    await user.click(screen.getByRole('button', { name: 'Start consultation' }))
    dialog = within(screen.getByRole('dialog', { name: 'Complete visit' }))
    expect(dialog.queryByRole('combobox', { name: /Confirmed allergy status/ })).not.toBeInTheDocument()
    await user.type(dialog.getByRole('textbox', { name: /Assessment \/ diagnosis/ }), 'Allergic rhinitis')
    await user.type(dialog.getByRole('textbox', { name: /Consultation notes/ }), 'Reviewed skin test')
    await user.click(dialog.getByRole('checkbox', { name: /reviewed the allergy information/ }))
    expect(dialog.getByRole('button', { name: 'Save visit to patient history' })).toBeDisabled()

    await user.click(dialog.getByRole('radio', { name: /Remove documented allergy/ }))
    expect(dialog.getByRole('button', { name: 'Save visit to patient history' })).toBeDisabled()
    await user.type(dialog.getByRole('textbox', { name: /Reason for removing/ }), 'Penicillin ruled out by clinical history')
    await user.click(dialog.getByRole('button', { name: 'Save visit to patient history' }))
    const chart = savedPatients().find((item) => item.id === 'patient-a')!
    expect(chart).toMatchObject({ allergyStatus: 'none', allergy: 'No known allergies' })
    expect(chart.records[0].allergyReview).toEqual({ decision: 'removed', reportedStatus: 'none', documentedAllergy: 'Penicillin', reason: 'Penicillin ruled out by clinical history' })
  })

  it('reconciles untriaged doctor allergy confirmation without erasing documented allergies', async () => {
    localStorage.setItem(storageKeys.patients, JSON.stringify(documentedPatient()))
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ entries: [allergyEntry({ stage: 'ready' })] })))
    const user = createUser()
    renderDemo()
    await openQueue(user)
    await user.click(screen.getByRole('button', { name: 'Start consultation' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Complete visit' }))
    await user.type(dialog.getByRole('textbox', { name: /Assessment \/ diagnosis/ }), 'Tension headache')
    await user.type(dialog.getByRole('textbox', { name: /Consultation notes/ }), 'Rest advised')
    await user.click(dialog.getByRole('checkbox', { name: /reviewed the allergy information/ }))

    await user.selectOptions(dialog.getByRole('combobox', { name: /Confirmed allergy status/ }), 'none')
    expect(dialog.getByText('Allergy difference to review')).toBeInTheDocument()
    await user.click(dialog.getByRole('radio', { name: /Keep documented allergy/ }))
    await user.click(dialog.getByRole('button', { name: 'Save visit to patient history' }))
    const chart = savedPatients().find((item) => item.id === 'patient-a')!
    expect(chart).toMatchObject({ allergyStatus: 'known', allergy: 'Penicillin' })
    expect(chart.records[0].allergyReview).toEqual({ decision: 'kept', reportedStatus: 'none', documentedAllergy: 'Penicillin', reason: '' })
  })
})

describe('SRS QUE-04 and QUE-05: queue lanes and manual entry', () => {
  const waitingTicket = (overrides: Partial<QueueEntry>): QueueEntry => ({
    id: 'q-x', number: 'R-001', name: 'Alice Santos', phone: '09171234567', joinedAt: '2026-11-09T01:00:00.000Z',
    status: 'waiting' as const, patientId: 'patient-a', stage: 'ready' as const, lane: 'regular' as const, ...overrides,
  })

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 9, 9, 0, 0))
  })

  it('orders priority lane ahead of adults, updates patient queue standing without leaking names, and keeps legacy tickets working', async () => {
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ entries: [
      waitingTicket({ id: 'q-adult', number: 'R-001', name: 'Alice Santos', joinedAt: '2026-11-09T00:50:00.000Z' }),
      waitingTicket({ id: 'q-senior', number: 'P-001', name: 'Bea Cruz', patientId: 'patient-b', lane: 'priority', birthDate: '1950-01-01', joinedAt: '2026-11-09T00:55:00.000Z' }),
    ] })))
    const user = createUser()
    renderDemo()
    await openQueue(user)
    const rows = document.querySelectorAll('.queue-table-row')
    expect(rows[0]).toHaveTextContent('Bea Cruz')
    expect(rows[0]).toHaveTextContent('Senior')
    expect(rows[1]).toHaveTextContent('Alice Santos')
    await user.click(screen.getByRole('button', { name: 'Call next' }))
    expect(savedQueue().entries.map((entry) => entry.status)).toEqual(['waiting', 'called'])
    cleanup()

    render(<App />)
    await signIntoDemo(user, 'Patient')
    const summary = screen.getByLabelText('Today’s queue')
    expect(summary).toHaveTextContent('Now serving: P-001')
    expect(summary).toHaveTextContent('1 waiting')
    expect(screen.queryByText(/Bea Cruz|Alice Santos/)).not.toBeInTheDocument()
    cleanup()

    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ entries: [{
      id: 'q-old', number: '001', name: 'Alice Santos', phone: '09171234567', joinedAt: '2026-11-09T00:50:00.000Z', status: 'waiting', patientId: 'patient-a', stage: 'ready',
    }] })))
    renderDemo()
    await openQueue(user)
    expect(screen.getByRole('button', { name: 'Call next' })).toBeEnabled()
    expect(document.querySelector('.queue-lane-badge')).toBeNull()
  })

  it('allows manual urgent/non-urgent entry across intake states, rejects invalid or duplicate entries, and blocks patients', async () => {
    const user = createUser()
    renderDemo()
    await openQueue(user)
    await user.click(screen.getByRole('button', { name: 'Add patient manually' }))

    let dialog = within(screen.getByRole('dialog', { name: /Add patient to today’s queue/ }))
    await user.click(dialog.getByRole('checkbox', { name: /Urgent or emergency/ }))
    await user.type(dialog.getByRole('textbox', { name: /Patient name/ }), 'Emergency Case')
    fireEvent.change(dialog.getByLabelText('Date of birth'), { target: { value: '1990-05-10' } })
    await user.selectOptions(dialog.getByRole('combobox', { name: /Sex/ }), 'Male')
    await user.click(dialog.getByRole('button', { name: 'Add as urgent' }))
    expect(dialog.getByRole('alert')).toHaveTextContent('Enter why this patient is urgent.')
    expect(localStorage.getItem(storageKeys.queue)).toBeNull()

    await user.type(dialog.getByRole('textbox', { name: /Why is this urgent/ }), 'Chest pain')
    await user.click(dialog.getByRole('button', { name: 'Add as urgent' }))
    expect(savedQueue()).toMatchObject({ isOpen: false })
    expect(savedQueue().entries[0]).toMatchObject({ number: 'U-001', lane: 'urgent', addedBy: 'Doctor', reportedReason: 'Chest pain' })

    await user.click(screen.getByRole('button', { name: 'Add patient manually' }))
    dialog = within(screen.getByRole('dialog', { name: /Add patient to today’s queue/ }))
    await user.type(dialog.getByRole('textbox', { name: /Patient name/ }), 'Alice Santos')
    fireEvent.change(dialog.getByLabelText('Date of birth'), { target: { value: '1990-05-10' } })
    await user.selectOptions(dialog.getByRole('combobox', { name: /Sex/ }), 'Female')
    await user.type(dialog.getByRole('textbox', { name: /Phone/ }), '0917 123 4567')
    await user.click(dialog.getByRole('button', { name: 'Add to queue' }))
    expect(savedPatients()).toHaveLength(3)
    expect(savedQueue().entries[1].patientId).toBe('patient-a')

    await user.click(screen.getByRole('button', { name: 'Add patient manually' }))
    dialog = within(screen.getByRole('dialog', { name: /Add patient to today’s queue/ }))
    await user.type(dialog.getByRole('textbox', { name: /Patient name/ }), 'alice santos')
    fireEvent.change(dialog.getByLabelText('Date of birth'), { target: { value: '1990-05-10' } })
    await user.selectOptions(dialog.getByRole('combobox', { name: /Sex/ }), 'Female')
    await user.type(dialog.getByRole('textbox', { name: /Phone/ }), '09171234567')
    await user.click(dialog.getByRole('button', { name: 'Add to queue' }))
    expect(dialog.getByRole('alert')).toHaveTextContent('already in today’s queue as R-001')
    await user.click(dialog.getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Call next' }))
    expect(savedQueue().entries.find((item) => item.status === 'called')?.number).toBe('U-001')
    cleanup()

    render(<App />)
    await signIntoDemo(user, 'Attendant')
    await user.click(screen.getByRole('button', { name: 'Add to queue' }))
    dialog = within(screen.getByRole('dialog', { name: /Add patient to today’s queue/ }))
    await user.type(dialog.getByRole('textbox', { name: /Patient name/ }), 'Alice Santos')
    fireEvent.change(dialog.getByLabelText('Date of birth'), { target: { value: '1990-05-10' } })
    await user.selectOptions(dialog.getByRole('combobox', { name: /Sex/ }), 'Female')
    await user.click(dialog.getByRole('button', { name: 'Add to queue' }))
    expect(savedPatients()).toHaveLength(4)
    expect(savedQueue().entries.at(-1)).toMatchObject({ addedBy: 'Attendant', number: 'R-002' })
    cleanup()

    render(<App />)
    await signIntoDemo(user, 'Patient')
    expect(screen.queryByRole('button', { name: /Add to queue|Add patient manually/ })).not.toBeInTheDocument()
  })
})
