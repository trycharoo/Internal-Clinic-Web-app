import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { dateKey, type Patient, type QueueEntry, type QueueSession } from './clinic'
import { appointment, patient, queue, storageKeys } from './test/fixtures'

vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,dGVzdA==') } }))

const secondPatient = () => patient({ id: 'patient-b', name: 'Bea Cruz', initials: 'BC', patientNumber: 'PT-10002', phone: '09179876543', email: 'bea@example.test' })

beforeEach(() => {
  localStorage.setItem(storageKeys.patients, JSON.stringify([patient(), secondPatient()]))
  localStorage.setItem(storageKeys.appointments, '[]')
})

function renderDemo() {
  const view = render(<App />)
  if (!new URLSearchParams(window.location.search).get('queue')) {
    fireEvent.click(screen.getByRole('button', { name: 'Explore demo workspace' }))
  }
  return view
}

function savedPatients(): Patient[] {
  return JSON.parse(localStorage.getItem(storageKeys.patients)!)
}

function savedQueue(): QueueSession {
  return JSON.parse(localStorage.getItem(storageKeys.queue)!)
}

async function openChart(user: ReturnType<typeof userEvent.setup>, name = 'Alice Santos') {
  const searchField = screen.getByRole('textbox', { name: 'Search patients' })
  await user.type(searchField, name)
  await user.click(within(searchField.parentElement!).getByRole('button', { name: new RegExp(name) }))
  expect(screen.getByRole('heading', { level: 1, name })).toBeInTheDocument()
}

async function startVisit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole('button', { name: 'Start visit' })[0])
}

async function prescriptionTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^Prescriptions\s*\d+/ }))
}

async function openQueue(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', { name: /^Daily queue/ }))
}

async function joinPreview(user: ReturnType<typeof userEvent.setup>, name: string, phone: string, sex = 'Female', birthDate = '1990-05-10') {
  await user.click(screen.getByRole('button', { name: 'Preview patient check-in' }))
  await user.type(screen.getByRole('textbox', { name: /Full name/ }), name)
  await user.type(screen.getByRole('textbox', { name: /Phone number/ }), phone)
  fireEvent.change(document.querySelector<HTMLInputElement>('input[type="date"]')!, { target: { value: birthDate } })
  await user.selectOptions(screen.getByRole('combobox', { name: /Sex/ }), sex)
  await user.selectOptions(screen.getByRole('combobox', { name: /Allergy status/ }), 'none')
  await user.click(screen.getByRole('button', { name: 'Get my queue number' }))
}

describe('patient registration', () => {
  it.each([
    ['unknown', 'Not recorded'], ['none', 'No known allergies'], ['known', 'Latex'],
  ])('registers a patient with explicit %s allergy status and persists their chart', async (status, allergy) => {
    const user = userEvent.setup()
    renderDemo()
    await user.click(screen.getByRole('button', { name: 'New walk-in' }))
    const dialog = within(screen.getByRole('dialog', { name: 'New walk-in patient' }))
    await user.type(dialog.getByRole('textbox', { name: /Patient name/ }), '  Carla Diaz  ')
    fireEvent.change(dialog.getByLabelText('Date of birth'), { target: { value: '1995-04-03' } })
    await user.selectOptions(dialog.getByRole('combobox', { name: /Sex/ }), 'Female')
    await user.selectOptions(dialog.getByRole('combobox', { name: /Allergy status/ }), status)
    if (status === 'known') await user.type(dialog.getByRole('textbox', { name: /^Known allergies/ }), '  Latex  ')
    await user.click(dialog.getByRole('button', { name: 'Register & open chart' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Carla Diaz' })).toBeInTheDocument()
    expect(savedPatients()[0]).toMatchObject({ name: 'Carla Diaz', birthDate: '1995-04-03', sex: 'Female', allergyStatus: status, allergy })
    expect(savedPatients()[0].id).not.toBe('patient-a')
    expect(savedPatients()[0].records).toEqual([])
  })

  it('rejects whitespace-only known allergy details without registering', async () => {
    const user = userEvent.setup()
    renderDemo()
    await user.click(screen.getByRole('button', { name: 'New walk-in' }))
    const dialog = within(screen.getByRole('dialog'))
    await user.type(dialog.getByRole('textbox', { name: /Patient name/ }), 'Carla Diaz')
    fireEvent.change(dialog.getByLabelText('Date of birth'), { target: { value: '1995-04-03' } })
    await user.selectOptions(dialog.getByRole('combobox', { name: /Sex/ }), 'Prefer not to say')
    await user.selectOptions(dialog.getByRole('combobox', { name: /Allergy status/ }), 'known')
    await user.type(dialog.getByRole('textbox', { name: /^Known allergies/ }), '   ')
    await user.click(dialog.getByRole('button', { name: 'Register & open chart' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the known allergy')
    expect(savedPatients()).toHaveLength(2)
  })

  it('rejects future dates of birth even if a form is submitted programmatically', async () => {
    const user = userEvent.setup()
    renderDemo()
    await user.click(screen.getByRole('button', { name: 'New walk-in' }))
    const dialog = within(screen.getByRole('dialog'))
    await user.type(dialog.getByRole('textbox', { name: /Patient name/ }), 'Carla Diaz')
    fireEvent.change(dialog.getByLabelText('Date of birth'), { target: { value: '2999-01-01' } })
    fireEvent.submit(dialog.getByRole('button', { name: 'Register & open chart' }).closest('form')!)
    expect(screen.getByRole('alert')).toHaveTextContent('Date of birth cannot be in the future')
    expect(savedPatients()).toHaveLength(2)
  })
})

describe('appointment booking', () => {
  it('defaults booking from a chart to that patient', async () => {
    const user = userEvent.setup()
    renderDemo()
    await openChart(user, 'Bea Cruz')
    await user.click(screen.getByRole('button', { name: 'Schedule' }))
    expect(screen.getByRole('combobox', { name: /^Patient/ })).toHaveValue('patient-b')
    await user.click(screen.getByRole('button', { name: 'Confirm appointment' }))
    expect(JSON.parse(localStorage.getItem(storageKeys.appointments)!)[0]).toMatchObject({ patientId: 'patient-b', reason: 'Office visit', status: 'scheduled' })
  })

  it('keeps a conflicting booking open and accepts an adjacent slot after correction', async () => {
    localStorage.setItem(storageKeys.appointments, JSON.stringify([appointment({ time: '11:00', duration: 45 })]))
    const user = userEvent.setup()
    renderDemo()
    await user.click(screen.getByRole('button', { name: 'Schedule appointment' }))
    await user.click(screen.getByRole('button', { name: 'Confirm appointment' }))
    expect(screen.getByRole('alert')).toHaveTextContent('That time overlaps an existing appointment')
    expect(JSON.parse(localStorage.getItem(storageKeys.appointments)!)).toHaveLength(1)
    await user.selectOptions(screen.getByRole('combobox', { name: /Start time/ }), '12:00')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm appointment' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(storageKeys.appointments)!)).toHaveLength(2)
  })
})

describe('clinical documentation', () => {
  it('reviews editable extracted text before saving it to only the active patient chart', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ filename: 'lab-result.pdf', file_type: 'pdf', page_count: 2, ocr_pages_used: [2], text: 'Original extracted result', processing_time_ms: 120 }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderDemo()
    await openChart(user)
    const input = screen.getByLabelText('Choose a patient document') as HTMLInputElement
    const file = new File(['synthetic pdf'], 'lab-result.pdf', { type: 'application/pdf' })
    await user.upload(input, file)
    expect(fetchMock).toHaveBeenCalledWith('/api/documents/parse', expect.objectContaining({ method: 'POST' }))
    expect(screen.getByRole('dialog', { name: 'Review extracted text' })).toBeInTheDocument()
    const review = screen.getByRole('textbox', { name: /Extracted text/ })
    await user.clear(review)
    await user.type(review, 'Doctor corrected result')
    expect(savedPatients()[0].documents).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Save to patient chart' }))
    expect(savedPatients()[0].documents).toMatchObject([{ filename: 'lab-result.pdf', pageCount: 2, ocrPagesUsed: [2], text: 'Doctor corrected result' }])
    expect(savedPatients()[1].documents).toEqual([])
    expect(screen.getByText('Doctor corrected result')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('keeps parser errors visible and does not save a failed upload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'Unsupported file type' }), { status: 415, headers: { 'content-type': 'application/json' } })))
    const user = userEvent.setup()
    renderDemo()
    await openChart(user)
    fireEvent.change(screen.getByLabelText('Choose a patient document'), { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Unsupported file type')
    expect(savedPatients()[0].documents).toEqual([])
    expect(screen.queryByRole('dialog', { name: 'Review extracted text' })).not.toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('snapshots interview-only notes into visit history and preserves them after reload', async () => {
    const user = userEvent.setup()
    const view = renderDemo()
    await openChart(user)
    await startVisit(user)
    await user.type(screen.getByLabelText(/Interview notes/), 'Patient reports symptoms since yesterday.')
    expect(savedPatients()[0].notes).toBe('Patient reports symptoms since yesterday.')
    await user.click(screen.getByRole('button', { name: 'Save visit to chart' }))
    expect(screen.getByText('Patient reports symptoms since yesterday.')).toBeInTheDocument()
    expect(savedPatients()[0]).toMatchObject({ notes: '', lastVisit: dateKey(new Date()), records: [{ notes: 'Patient reports symptoms since yesterday.', signs: '', symptoms: '', diagnosis: '' }] })
    view.unmount()
    renderDemo()
    await openChart(user)
    await user.click(screen.getByRole('button', { name: /^Medical history/ }))
    expect(screen.getByText('Patient reports symptoms since yesterday.')).toBeInTheDocument()
  })

  it('rejects a completely empty visit without adding a record', async () => {
    const user = userEvent.setup()
    renderDemo()
    await openChart(user)
    await startVisit(user)
    await user.click(screen.getByRole('button', { name: 'Save visit to chart' }))
    expect(screen.getByText('Add a note, signs, symptoms, or diagnosis before saving.')).toBeInTheDocument()
    expect(savedPatients()[0].records).toHaveLength(0)
  })

  it('saves signs, symptoms, and diagnosis to the correct patient', async () => {
    const user = userEvent.setup()
    renderDemo()
    await openChart(user, 'Bea Cruz')
    await startVisit(user)
    await user.type(screen.getByPlaceholderText('e.g. Blood pressure, temperature, exam findings'), 'Temperature 37.0 C')
    await user.type(screen.getByPlaceholderText('e.g. Onset, duration, and associated symptoms'), 'Follow-up concern')
    await user.type(screen.getByPlaceholderText('Add a working diagnosis'), 'Follow-up assessment')
    await user.click(screen.getByRole('button', { name: 'Save visit to chart' }))
    expect(savedPatients()[1].records[0]).toMatchObject({ signs: 'Temperature 37.0 C', symptoms: 'Follow-up concern', diagnosis: 'Follow-up assessment' })
    expect(savedPatients()[0].records).toHaveLength(0)
    expect(screen.getByText('Follow-up assessment')).toBeInTheDocument()
  })

  it('assigns distinct record IDs when multiple records are saved in the same millisecond', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-09T10:00:00'))
    const user = userEvent.setup()
    renderDemo()
    await openChart(user)
    await startVisit(user)
    await user.type(screen.getByPlaceholderText('Add a working diagnosis'), 'First note')
    await user.click(screen.getByRole('button', { name: 'Save visit to chart' }))
    await user.click(screen.getByRole('button', { name: 'Add visit note' }))
    await user.type(screen.getByPlaceholderText('Add a working diagnosis'), 'Second note')
    await user.click(screen.getByRole('button', { name: 'Save visit to chart' }))
    const records = savedPatients()[0].records
    expect(records).toHaveLength(2)
    expect(new Set(records.map((record) => record.id)).size).toBe(2)
    expect(screen.getByText('First note')).toBeInTheDocument()
    expect(screen.getByText('Second note')).toBeInTheDocument()
  })

  it('resets unsaved structured visit fields when switching to another patient', async () => {
    const user = userEvent.setup()
    renderDemo()
    await openChart(user)
    await startVisit(user)
    await user.type(screen.getByPlaceholderText('Add a working diagnosis'), 'Alice only')
    await user.type(screen.getByLabelText(/Interview notes/), 'Alice draft')
    await openChart(user, 'Bea Cruz')
    await startVisit(user)
    expect(screen.getByPlaceholderText('Add a working diagnosis')).toHaveValue('')
    expect(screen.getByLabelText(/Interview notes/)).toHaveValue('')
    expect(savedPatients()[0].notes).toBe('Alice draft')
  })

  it('saves a prescription to its patient and does not carry the preview into another chart', async () => {
    const user = userEvent.setup()
    renderDemo()
    await openChart(user)
    await prescriptionTab(user)
    await user.type(screen.getByRole('textbox', { name: /Medication name/ }), '  Demo medication  ')
    await user.type(screen.getByRole('textbox', { name: 'Strength' }), '10 mg')
    await user.type(screen.getByRole('textbox', { name: 'Directions for use' }), 'Synthetic test directions')
    await user.click(screen.getByRole('button', { name: 'Add to chart' }))
    expect(savedPatients()[0].prescriptions[0]).toMatchObject({ medication: 'Demo medication', strength: '10 mg', instructions: 'Synthetic test directions' })
    expect(screen.getByRole('textbox', { name: /Medication name/ })).toHaveValue('')
    await user.type(screen.getByRole('textbox', { name: /Medication name/ }), 'Unsaved Alice draft')
    await openChart(user, 'Bea Cruz')
    await prescriptionTab(user)
    expect(screen.getByRole('textbox', { name: /Medication name/ })).toHaveValue('')
    expect(screen.queryByText('Demo medication')).not.toBeInTheDocument()
    expect(savedPatients()[1].prescriptions).toEqual([])
  })
})

describe('daily walk-in queue', () => {
  it('links check-in, consultation, prescription, and history to one encounter without triage', async () => {
    const user = userEvent.setup()
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
    await joinPreview(user, 'Bea Cruz', '0917-987-6543')
    expect(screen.getByRole('status')).toHaveTextContent('002')
    await user.click(screen.getByRole('button', { name: 'Back to clinic' }))
    // Triage is optional: both patients are already waiting for the doctor.
    expect(savedQueue().entries.map((entry) => entry.stage)).toEqual(['ready', 'ready'])
    expect(screen.getByRole('button', { name: 'Call next' })).toBeEnabled()
    await user.click(screen.getAllByRole('button', { name: 'Start consultation' })[0])
    const consultation = screen.getByRole('dialog', { name: 'Complete visit' })
    await user.type(within(consultation).getByRole('textbox', { name: /Assessment \/ diagnosis/ }), 'Tension headache')
    await user.type(within(consultation).getByRole('textbox', { name: /Consultation notes/ }), 'Rest and hydration discussed')
    await user.click(within(consultation).getByRole('checkbox', { name: /reviewed the allergy information/ }))
    await user.click(within(consultation).getByText('Add prescription to this encounter (optional draft)'))
    await user.type(within(consultation).getByRole('textbox', { name: 'Medication' }), 'Demo analgesic')
    await user.type(within(consultation).getByRole('textbox', { name: 'Directions' }), 'Take as directed in this synthetic demo')
    // The doctor confirms allergies with the patient because no attendant did.
    expect(within(consultation).getByRole('button', { name: 'Save visit to patient history' })).toBeDisabled()
    await user.selectOptions(within(consultation).getByRole('combobox', { name: /Confirmed allergy status/ }), 'none')
    await user.click(within(consultation).getByRole('button', { name: 'Save visit to patient history' }))
    expect(savedQueue().entries.map((entry) => entry.stage)).toEqual(['complete', 'ready'])
    expect(savedPatients()).toHaveLength(2)
    const linkedPatient = savedPatients().find((item) => item.id === savedQueue().entries[0].patientId)!
    expect(linkedPatient).toMatchObject({ allergyStatus: 'none', allergy: 'No known allergies' })
    expect(linkedPatient.records[0]).toMatchObject({ diagnosis: 'Tension headache', symptoms: '', notes: 'Existing live-saved interview draft.\n\nRest and hydration discussed', encounterId: savedQueue().entries[0].id })
    expect(linkedPatient.records[0].triage).toBeUndefined()
    expect(linkedPatient.notes).toBe('')
    expect(linkedPatient.prescriptions[0]).toMatchObject({ medication: 'Demo analgesic', encounterId: savedQueue().entries[0].id })
    expect(linkedPatient.records[0].encounterId).toBe(linkedPatient.prescriptions[0].encounterId)
    await user.click(screen.getByRole('button', { name: 'View history' }))
    expect(screen.getByRole('heading', { level: 1, name: linkedPatient.name })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Medical history' })).toBeInTheDocument()
    expect(screen.getByText(/Tension headache/)).toBeInTheDocument()
  })

  it('accepts unknown sex while keeping a self-reported allergy unconfirmed until reception triage', async () => {
    const user = userEvent.setup()
    renderDemo()
    await openQueue(user)
    await user.click(screen.getByRole('button', { name: 'Generate today’s QR' }))
    await screen.findByAltText('QR code for today’s patient check-in')
    await joinPreview(user, 'Unknown Sex Demo', '09171230000', 'Unknown')
    expect(savedPatients().find((item) => item.name === 'Unknown Sex Demo')).toMatchObject({ sex: 'Unknown', allergyStatus: 'unknown', allergy: 'Not recorded' })
    expect(savedQueue().entries[0]).toMatchObject({ reportedAllergyStatus: 'none', reportedAllergy: '' })
  })

  it('requires nonblank allergy details before reception can confirm a known allergy', async () => {
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ entries: [{
      id: 'q-allergy', number: '001', name: 'Alice Santos', phone: '09171234567', joinedAt: new Date().toISOString(),
      status: 'waiting', patientId: 'patient-a', stage: 'triage', reportedAllergyStatus: 'known', reportedAllergy: 'Penicillin',
    }] })))
    const user = userEvent.setup()
    render(<App />)
    await signIntoDemo(user, 'Attendant')
    await user.click(screen.getByRole('button', { name: 'Record triage' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Record triage' }))
    await user.type(dialog.getByLabelText(/Chief complaint/), 'Synthetic allergy review')
    await user.selectOptions(dialog.getByRole('combobox', { name: /Confirmed allergy status/ }), 'known')
    await user.type(dialog.getByRole('textbox', { name: /Confirmed allergies/ }), '   ')
    await user.click(dialog.getByRole('checkbox', { name: /verified the allergy status/ }))
    await user.click(dialog.getByRole('button', { name: 'Save triage & hand off' }))
    expect(dialog.getByRole('alert')).toHaveTextContent('Enter the confirmed allergy details')
    expect(savedQueue().entries[0].stage).toBe('triage')
    expect(savedPatients()[0]).toMatchObject({ allergyStatus: 'unknown', allergy: 'Not recorded' })
    await user.clear(dialog.getByRole('textbox', { name: /Confirmed allergies/ }))
    await user.type(dialog.getByRole('textbox', { name: /Confirmed allergies/ }), 'Penicillin')
    await user.click(dialog.getByRole('button', { name: 'Save triage & hand off' }))
    expect(savedQueue().entries[0].stage).toBe('ready')
    expect(savedPatients()[0]).toMatchObject({ allergyStatus: 'known', allergy: 'Penicillin' })
  })

  it('blocks paused queues and permits check-in again when reopened', async () => {
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue()))
    const user = userEvent.setup()
    renderDemo()
    await openQueue(user)
    await user.click(screen.getByRole('button', { name: 'Pause check-in' }))
    await user.click(screen.getByRole('button', { name: 'Preview patient check-in' }))
    expect(screen.getByRole('status')).toHaveTextContent('Check-in is paused')
    expect(screen.queryByRole('button', { name: 'Get my queue number' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to clinic' }))
    await user.click(screen.getByRole('button', { name: 'Reopen check-in' }))
    await user.click(screen.getByRole('button', { name: 'Preview patient check-in' }))
    expect(screen.getByRole('button', { name: 'Get my queue number' })).toBeEnabled()
  })

  it.each(['expired', 'wrong-token'])('rejects an %s check-in link', (scenario) => {
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue(scenario === 'expired' ? { date: '2000-01-01' } : {})))
    window.history.replaceState({}, '', `/?queue=${scenario === 'expired' ? 'test-daily-token' : 'not-the-token'}`)
    renderDemo()
    expect(screen.getByRole('alert')).toHaveTextContent('This check-in link isn’t connected')
    expect(screen.queryByRole('button', { name: 'Get my queue number' })).not.toBeInTheDocument()
  })

  it('rejects a previously open check-in form when the local day has changed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-09T23:59:00'))
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue()))
    window.history.replaceState({}, '', '/?queue=test-daily-token')
    const user = userEvent.setup()
    renderDemo()
    await user.type(screen.getByRole('textbox', { name: /Full name/ }), 'Late arrival')
    await user.type(screen.getByRole('textbox', { name: /Phone number/ }), '09171234567')
    fireEvent.change(document.querySelector<HTMLInputElement>('input[type="date"]')!, { target: { value: '1990-05-10' } })
    await user.selectOptions(screen.getByRole('combobox', { name: /Sex/ }), 'Female')
    await user.selectOptions(screen.getByRole('combobox', { name: /Allergy status/ }), 'none')
    vi.setSystemTime(new Date('2026-11-10T00:01:00'))
    await user.click(screen.getByRole('button', { name: 'Get my queue number' }))
    expect(screen.getByRole('alert')).toHaveTextContent('This check-in link isn’t connected')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(savedQueue().entries).toHaveLength(0)
  })

  it('updates the clinic queue from a valid storage event and ignores malformed payloads safely', async () => {
    const user = userEvent.setup()
    renderDemo()
    await openQueue(user)
    fireEvent(window, new StorageEvent('storage', { key: storageKeys.queue, newValue: JSON.stringify(queue({ entries: [{ id: 'entry-1', number: '001', name: 'Test arrival', phone: '1234', joinedAt: new Date().toISOString(), status: 'waiting' }] })) }))
    expect(screen.getByText('Test arrival')).toBeInTheDocument()
    fireEvent(window, new StorageEvent('storage', { key: storageKeys.queue, newValue: JSON.stringify({ date: dateKey(new Date()), entries: null }) }))
    expect(screen.getByText('No patients in line yet')).toBeInTheDocument()
  })
})

describe('browser storage resilience', () => {
  it.each(['{}', 'null', '{'])('recovers from invalid stored patient and appointment data %s', (raw) => {
    localStorage.setItem(storageKeys.patients, raw)
    localStorage.setItem(storageKeys.appointments, raw)
    localStorage.setItem(storageKeys.queue, raw)
    renderDemo()
    expect(screen.getByRole('heading', { level: 1, name: /Good morning/ })).toBeInTheDocument()
    expect(savedPatients()).toHaveLength(5)
  })

  it('keeps the app usable and warns when browser storage is full', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError') })
    renderDemo()
    expect(screen.getByRole('heading', { level: 1, name: /Good morning/ })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Browser storage is unavailable. Changes may be lost when you reload.')
  })

  it('shows storage failure on the patient ticket when a check-in cannot persist', async () => {
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue()))
    window.history.replaceState({}, '', '/?queue=test-daily-token')
    const user = userEvent.setup()
    renderDemo()
    await user.type(screen.getByRole('textbox', { name: /Full name/ }), 'Test arrival')
    await user.type(screen.getByRole('textbox', { name: /Phone number/ }), '09171234567')
    fireEvent.change(document.querySelector<HTMLInputElement>('input[type="date"]')!, { target: { value: '1990-05-10' } })
    await user.selectOptions(screen.getByRole('combobox', { name: /Sex/ }), 'Female')
    await user.selectOptions(screen.getByRole('combobox', { name: /Allergy status/ }), 'none')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError') })
    await user.click(screen.getByRole('button', { name: 'Get my queue number' }))
    expect(screen.getByRole('status')).toHaveTextContent('001')
    expect(screen.getByRole('alert')).toHaveTextContent('Browser storage is unavailable')
    expect(savedQueue().entries).toHaveLength(0)
  })

  it('trims outer spaces in global patient searches', async () => {
    const user = userEvent.setup()
    renderDemo()
    const searchField = screen.getByRole('textbox', { name: 'Search patients' })
    await user.type(searchField, '  Bea Cruz  ')
    expect(within(searchField.parentElement!).getByRole('button', { name: /Bea Cruz/ })).toBeInTheDocument()
  })
})

describe('demo controls and role preview', () => {
  it('returns from the synthetic workspace to sign-in without granting a selected role access', async () => {
    const user = userEvent.setup()
    renderDemo()
    await user.click(screen.getByRole('button', { name: 'Log in as' }))
    expect(screen.getByRole('button', { name: 'Explore demo workspace' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Patient' }))
    expect(screen.getByRole('heading', { name: 'Your care starts here.' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Search patients' })).not.toBeInTheDocument()
    expect(savedPatients()).toHaveLength(2)
  })

  it('preserves an unsaved visit draft when viewing sign-in and returning to the demo', async () => {
    const user = userEvent.setup()
    renderDemo()
    await openChart(user)
    await startVisit(user)
    await user.type(screen.getByPlaceholderText('e.g. Blood pressure, temperature, exam findings'), 'Synthetic observed signs')
    await user.type(screen.getByPlaceholderText('e.g. Onset, duration, and associated symptoms'), 'Synthetic symptoms draft')
    await user.type(screen.getByPlaceholderText('Add a working diagnosis'), 'Synthetic assessment draft')
    await user.click(screen.getByRole('button', { name: 'Log in as' }))
    expect(screen.queryByRole('textbox', { name: 'Search patients' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Explore demo workspace' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Explore demo workspace' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Alice Santos' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('e.g. Blood pressure, temperature, exam findings')).toHaveValue('Synthetic observed signs')
    expect(screen.getByPlaceholderText('e.g. Onset, duration, and associated symptoms')).toHaveValue('Synthetic symptoms draft')
    expect(screen.getByPlaceholderText('Add a working diagnosis')).toHaveValue('Synthetic assessment draft')
    expect(savedPatients()[0].records).toEqual([])
    expect(savedPatients()[1].records).toEqual([])
  })

  it('preserves an unsaved prescription draft when viewing sign-in and returning to the demo', async () => {
    const user = userEvent.setup()
    renderDemo()
    await openChart(user)
    await prescriptionTab(user)
    await user.type(screen.getByRole('textbox', { name: /Medication name/ }), 'Synthetic draft medication')
    await user.type(screen.getByRole('textbox', { name: /Strength/ }), 'Synthetic draft strength')
    await user.type(screen.getByRole('textbox', { name: 'Directions for use' }), 'Synthetic draft directions')
    await user.click(screen.getByRole('button', { name: 'Log in as' }))
    await user.click(screen.getByRole('button', { name: 'Explore demo workspace' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Alice Santos' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Medication name/ })).toHaveValue('Synthetic draft medication')
    expect(screen.getByRole('textbox', { name: /Strength/ })).toHaveValue('Synthetic draft strength')
    expect(screen.getByRole('textbox', { name: 'Directions for use' })).toHaveValue('Synthetic draft directions')
    expect(savedPatients()[0].prescriptions).toEqual([])
    expect(savedPatients()[1].prescriptions).toEqual([])
  })

  it('resets changed clinic records and queue state to the repeatable synthetic scenario', async () => {
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ entries: [{ id: 'q-old', number: '001', name: 'Test', phone: '0917', joinedAt: new Date().toISOString(), status: 'waiting' }] })))
    const user = userEvent.setup()
    renderDemo()
    await user.click(screen.getByRole('button', { name: 'Reset demo' }))
    expect(await screen.findByRole('heading', { name: /Good morning, Maya/ })).toBeInTheDocument()
    expect(screen.getByText('Paolo Mendoza')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(storageKeys.patients)!)).toHaveLength(5)
    expect(JSON.parse(localStorage.getItem(storageKeys.queue)!)).toBeNull()
  })
})


describe('role-specific sign-in forms', () => {
  it('opens on doctor sign-in before exposing any staff workspace', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Welcome back, doctor.' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/login')
    expect(screen.getByRole('button', { name: 'Doctor' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Email address', { exact: true })).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText('Password', { exact: true })).toHaveAttribute('type', 'password')
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Search patients' })).not.toBeInTheDocument()
  })

  it.each([
    ['Patient', 'Your care starts here.', 'Patient'],
    ['Attendant / Secretary', 'A smoother day starts here.', 'Attendant'],
    ['Doctor', 'Welcome back, doctor.', 'Doctor'],
  ])('rejects unknown credentials for the %s form without opening a demo session', async (role, heading, submitRole) => {
    const user = userEvent.setup()
    render(<App />)
    const records = localStorage.getItem(storageKeys.patients)
    await user.click(screen.getByRole('button', { name: role }))
    expect(screen.getByRole('button', { name: role })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Email address', { exact: true }), 'synthetic@example.test')
    await user.type(screen.getByLabelText('Password', { exact: true }), 'Synthetic-only-password')
    await user.click(screen.getByRole('button', { name: `Sign in as ${submitRole}` }))
    expect(screen.getByRole('alert')).toHaveTextContent(/These demo credentials do not match the selected role/)
    expect(window.location.pathname).toBe('/login')
    expect(screen.getByLabelText('Password')).toHaveValue('')
    expect(screen.getByLabelText('Email address')).toHaveValue('synthetic@example.test')
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument()
    expect(localStorage.getItem(storageKeys.patients)).toBe(records)
    expect(Object.values(localStorage).join(' ')).not.toContain('Synthetic-only-password')
    expect(Object.values(localStorage).join(' ')).not.toContain('synthetic@example.test')
    expect(sessionStorage.length).toBe(0)
  })

  it('rejects missing email and password, malformed email, and a whitespace-only password', async () => {
    const user = userEvent.setup()
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
    expect(screen.queryByText(/These demo credentials do not match the selected role/)).not.toBeInTheDocument()
    await user.clear(email)
    await user.type(email, '  synthetic@example.test  ')
    await user.clear(password)
    await user.type(password, 'Synthetic-only-password')
    await user.click(submit)
    expect(email).not.toHaveAttribute('aria-invalid', 'true')
    expect(password).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent(/These demo credentials do not match the selected role/)
  })

  it('toggles password visibility and clears credentials, validation and help when switching roles', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByLabelText('Email address', { exact: true }), 'synthetic@example.test')
    await user.type(screen.getByLabelText('Password', { exact: true }), 'Synthetic-only-password')
    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(screen.getByLabelText('Password', { exact: true })).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(screen.getByLabelText('Password', { exact: true })).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }))
    expect(screen.getByRole('status')).toHaveTextContent(/not|unavailable|connect/i)
    await user.click(screen.getByRole('button', { name: 'Show password' }))
    await user.click(screen.getByRole('button', { name: 'Patient' }))
    expect(screen.getByLabelText('Email address', { exact: true })).toHaveValue('')
    expect(screen.getByLabelText('Password', { exact: true })).toHaveValue('')
    expect(screen.getByLabelText('Password', { exact: true })).toHaveAttribute('type', 'password')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign in as Patient' }))
    expect(screen.getByLabelText('Email address', { exact: true })).toHaveAttribute('aria-invalid', 'true')
    await user.click(screen.getByRole('button', { name: 'Attendant / Secretary' }))
    expect(screen.getByLabelText('Email address', { exact: true })).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Password', { exact: true })).not.toHaveAttribute('aria-invalid', 'true')
    await user.click(screen.getByRole('button', { name: 'Need access?' }))
    expect(screen.getByRole('status')).toHaveTextContent(/clinic|administrator/i)
  })

  it('requires explicit demo entry again after remount while retaining synthetic chart data', async () => {
    const user = userEvent.setup()
    const view = render(<App />)
    await user.click(screen.getByRole('button', { name: 'Explore demo workspace' }))
    await openChart(user)
    await startVisit(user)
    await user.type(screen.getByLabelText(/Interview notes/), 'Synthetic note retained across sign-in.')
    view.unmount()
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Welcome back, doctor.' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Explore demo workspace' }))
    await openChart(user)
    await startVisit(user)
    expect(screen.getByLabelText(/Interview notes/)).toHaveValue('Synthetic note retained across sign-in.')
  })

  it('keeps a direct patient check-in route public and returns to sign-in without exposing staff tools', async () => {
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue()))
    window.history.replaceState({}, '', '/?queue=test-daily-token')
    const user = userEvent.setup()
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Join today’s queue' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Password', { exact: true })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to clinic' }))
    expect(screen.getByRole('heading', { name: 'Welcome back, doctor.' })).toBeInTheDocument()
    expect(window.location.search).toBe('')
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument()
  })
})


const demoAccounts = {
  Doctor: { email: 'doctor@northstar.demo', password: 'DoctorDemo123!', path: '/demo/doctor', heading: /Good morning, Maya/ },
  Attendant: { email: 'secretary@northstar.demo', password: 'StaffDemo123!', path: '/demo/attendant', heading: /^Reception workspace$/ },
  Patient: { email: 'patient@northstar.demo', password: 'PatientDemo123!', path: '/demo/patient', heading: /^Welcome, Sofia\.$/ },
} as const

type TestDemoRole = keyof typeof demoAccounts

async function signIntoDemo(user: ReturnType<typeof userEvent.setup>, role: TestDemoRole) {
  await user.click(screen.getByRole('button', { name: role === 'Attendant' ? 'Attendant / Secretary' : role }))
  await user.type(screen.getByLabelText('Email address'), demoAccounts[role].email)
  await user.type(screen.getByLabelText('Password'), demoAccounts[role].password)
  await user.click(screen.getByRole('button', { name: `Sign in as ${role}` }))
}

describe('explicit demo login routes and role sessions', () => {
  it.each(['/login', '/', '/demo/doctor', '/demo/attendant', '/demo/patient'])('normalizes fresh %s access to the login route without trusting its role', (path) => {
    window.history.replaceState({}, '', path)
    render(<App />)
    expect(window.location.pathname).toBe('/login')
    expect(screen.getByRole('heading', { name: 'Welcome back, doctor.' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Reception workspace' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Welcome, Sofia.' })).not.toBeInTheDocument()
  })

  it.each(['Doctor', 'Attendant', 'Patient'] as const)('fills the visible %s demo credentials only on request and opens its distinct route after submission', async (role) => {
    const user = userEvent.setup()
    render(<App />)
    const records = localStorage.getItem(storageKeys.patients)
    await user.click(screen.getByRole('button', { name: role === 'Attendant' ? 'Attendant / Secretary' : role }))
    await user.click(screen.getByText('Demo credentials', { exact: true }))
    expect(screen.getByText(demoAccounts[role].email, { exact: true })).toBeVisible()
    expect(screen.getByText(demoAccounts[role].password, { exact: true })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Use demo credentials' }))
    expect(screen.getByLabelText('Email address')).toHaveValue(demoAccounts[role].email)
    expect(screen.getByLabelText('Password')).toHaveValue(demoAccounts[role].password)
    expect(window.location.pathname).toBe('/login')
    expect(screen.queryByRole('heading', { name: demoAccounts[role].heading })).not.toBeInTheDocument()
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
  })

  it('rejects a valid doctor account selected under Patient without opening either workspace', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Patient' }))
    await user.type(screen.getByLabelText('Email address'), demoAccounts.Doctor.email)
    await user.type(screen.getByLabelText('Password'), demoAccounts.Doctor.password)
    await user.click(screen.getByRole('button', { name: 'Sign in as Patient' }))
    expect(screen.getByRole('alert')).toHaveTextContent('These demo credentials do not match the selected role.')
    expect(window.location.pathname).toBe('/login')
    expect(screen.getByLabelText('Password')).toHaveValue('')
    expect(screen.getByLabelText('Email address')).toHaveValue(demoAccounts.Doctor.email)
    expect(screen.queryByRole('heading', { name: /Good morning, Maya|Welcome, Sofia/ })).not.toBeInTheDocument()
  })

  it.each(['Doctor', 'Attendant', 'Patient'] as const)('clears the %s memory session when returning to login and cannot revive it from its old URL', async (role) => {
    const user = userEvent.setup()
    render(<App />)
    await signIntoDemo(user, role)
    expect(window.location.pathname).toBe(demoAccounts[role].path)
    await user.click(screen.getByRole('button', { name: 'Log in as' }))
    expect(window.location.pathname).toBe('/login')
    expect(screen.getByLabelText('Password')).toHaveValue('')
    window.history.pushState({}, '', demoAccounts[role].path)
    fireEvent.popState(window)
    expect(window.location.pathname).toBe('/login')
    expect(screen.getByRole('heading', { name: 'Welcome back, doctor.' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: demoAccounts[role].heading })).not.toBeInTheDocument()
  })

  it('keeps a same-role history route but clears the session when history requests a different role', async () => {
    const user = userEvent.setup()
    render(<App />)
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
  })

  it.each(['Doctor', 'Attendant', 'Patient'] as const)('requires fresh credentials after remounting the %s route', async (role) => {
    const user = userEvent.setup()
    const view = render(<App />)
    await signIntoDemo(user, role)
    const records = localStorage.getItem(storageKeys.patients)
    view.unmount()
    render(<App />)
    expect(window.location.pathname).toBe('/login')
    expect(screen.getByLabelText('Email address')).toHaveValue('')
    expect(screen.getByLabelText('Password')).toHaveValue('')
    expect(localStorage.getItem(storageKeys.patients)).toBe(records)
  })

  it('limits the patient preview to its own synthetic care and returns public check-in to that role', async () => {
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue()))
    const user = userEvent.setup()
    render(<App />)
    await signIntoDemo(user, 'Patient')
    expect(screen.getByRole('heading', { name: 'Welcome, Sofia.' })).toBeInTheDocument()
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
  })

  it('registers a patient at reception without opening a doctor chart or changing existing histories', async () => {
    const originalPatients = [patient({
      notes: 'Original synthetic interview note',
      records: [{ id: 'old-visit', date: '2026-01-10', signs: 'Original signs', symptoms: 'Original symptoms', diagnosis: 'Original assessment' }],
      prescriptions: [{ id: 'old-rx', date: '2026-01-10', medication: 'Synthetic original medication', strength: 'Original strength', instructions: 'Original directions', duration: 'Original duration', notes: 'Original prescription note' }],
    }), secondPatient()]
    localStorage.setItem(storageKeys.patients, JSON.stringify(originalPatients))
    const user = userEvent.setup()
    render(<App />)
    await signIntoDemo(user, 'Attendant')
    await user.click(screen.getByRole('button', { name: 'New walk-in' }))
    const dialog = within(screen.getByRole('dialog', { name: 'New walk-in patient' }))
    await user.type(dialog.getByRole('textbox', { name: /Patient name/ }), 'Carla Diaz')
    fireEvent.change(dialog.getByLabelText('Date of birth'), { target: { value: '1995-04-03' } })
    await user.selectOptions(dialog.getByRole('combobox', { name: /Sex/ }), 'Female')
    await user.type(dialog.getByRole('textbox', { name: /Contact number/ }), '09175550123')
    await user.selectOptions(dialog.getByRole('combobox', { name: /Allergy status/ }), 'known')
    await user.type(dialog.getByRole('textbox', { name: /^Known allergies/ }), 'Synthetic latex allergy')
    await user.click(dialog.getByRole('button', { name: /^Register/ }))
    expect(window.location.pathname).toBe('/demo/attendant')
    expect(screen.getByRole('heading', { name: 'Reception workspace' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const demographics = within(screen.getByRole('region', { name: 'Today’s patient details' }))
    expect(demographics.getByText('Carla Diaz')).toBeVisible()
    expect(demographics.getByText('1995-04-03')).toBeVisible()
    expect(demographics.getByText('Female')).toBeVisible()
    expect(demographics.getByText('09175550123')).toBeVisible()
    expect(screen.queryByRole('heading', { level: 1, name: 'Carla Diaz' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Clinical notes|Prescriptions|View history/ })).not.toBeInTheDocument()
    const patients = savedPatients()
    expect(patients).toHaveLength(3)
    expect(patients[0]).toMatchObject({ name: 'Carla Diaz', birthDate: '1995-04-03', phone: '09175550123', allergyStatus: 'known', allergy: 'Synthetic latex allergy', records: [], prescriptions: [] })
    expect(patients.slice(1)).toEqual(originalPatients)
  })

  it('keeps a conflicting reception booking open and adds a corrected slot to today’s list without altering original data', async () => {
    const originalAppointments = [appointment({ id: 'original-booking', time: '11:00', duration: 30, reason: 'Original synthetic follow-up' })]
    localStorage.setItem(storageKeys.appointments, JSON.stringify(originalAppointments))
    const originalPatients = savedPatients()
    const user = userEvent.setup()
    render(<App />)
    await signIntoDemo(user, 'Attendant')
    await user.click(screen.getByRole('button', { name: 'Book appointment' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Book an appointment' }))
    await user.selectOptions(dialog.getByRole('combobox', { name: /^Patient/ }), 'patient-b')
    await user.type(dialog.getByRole('textbox', { name: 'Visit type' }), 'Synthetic reception booking')
    await user.click(dialog.getByRole('button', { name: 'Confirm appointment' }))
    expect(dialog.getByRole('alert')).toHaveTextContent('That time overlaps an existing appointment')
    expect(screen.getByRole('dialog', { name: 'Book an appointment' })).toBeVisible()
    expect(JSON.parse(localStorage.getItem(storageKeys.appointments)!)).toEqual(originalAppointments)
    expect(savedPatients()).toEqual(originalPatients)
    await user.selectOptions(dialog.getByRole('combobox', { name: /^Start time/ }), '11:30')
    await user.click(dialog.getByRole('button', { name: 'Confirm appointment' }))
    expect(window.location.pathname).toBe('/demo/attendant')
    expect(screen.getByRole('heading', { name: 'Reception workspace' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const todayList = within(screen.getByRole('region', { name: 'Today’s appointments' }))
    expect(todayList.getByText('Original synthetic follow-up')).toBeVisible()
    expect(todayList.getByText('Synthetic reception booking')).toBeVisible()
    expect(todayList.getByText('Bea Cruz')).toBeVisible()
    expect(todayList.getByText('11:30')).toBeVisible()
    const appointments = JSON.parse(localStorage.getItem(storageKeys.appointments)!) as ReturnType<typeof appointment>[]
    expect(appointments).toHaveLength(2)
    expect(appointments[0]).toEqual(originalAppointments[0])
    expect(appointments[1]).toMatchObject({ patientId: 'patient-b', date: dateKey(new Date()), time: '11:30', duration: 30, reason: 'Synthetic reception booking' })
    expect(savedPatients()).toEqual(originalPatients)
    expect(screen.queryByRole('button', { name: /Clinical notes|Prescriptions|View history/ })).not.toBeInTheDocument()
  })

  it('lets reception record triage while withholding doctor-only tools and preserving chart history', async () => {
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ entries: [{
      id: 'q-reception', number: '001', name: 'Alice Santos', phone: '09171234567', joinedAt: new Date().toISOString(),
      status: 'waiting', patientId: 'patient-a', encounterId: 'encounter-reception', stage: 'triage',
    }] })))
    const user = userEvent.setup()
    render(<App />)
    await signIntoDemo(user, 'Attendant')
    expect(screen.getByRole('heading', { name: 'Reception workspace' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New walk-in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Book appointment' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Clinical notes|Prescriptions|Start consultation|Generate today’s QR|View history/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Search patients' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Record triage' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Record triage' }))
    await user.type(dialog.getByLabelText(/Chief complaint/), 'Synthetic reception complaint')
    await user.selectOptions(dialog.getByRole('combobox', { name: /Confirmed allergy status/ }), 'unknown')
    await user.click(dialog.getByRole('checkbox', { name: /confirmed their identity/ }))
    await user.click(dialog.getByRole('button', { name: 'Save triage & hand off' }))
    expect(savedQueue().entries[0]).toMatchObject({ stage: 'ready', triage: { complaint: 'Synthetic reception complaint' } })
    expect(savedPatients()[0].records).toEqual([])
    expect(savedPatients()[0].prescriptions).toEqual([])
    expect(screen.queryByRole('button', { name: 'Start consultation' })).not.toBeInTheDocument()
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

  it('shows the bundled hero and exposes a labeled image chooser without changing patient records', () => {
    render(<App />)
    const records = savedPatients()
    expect(hero()).toHaveAttribute('src', '/images/clinic-hero.jpg')
    expect(hero()).toHaveAttribute('alt', '')
    expect(screen.getByRole('button', { name: 'Change cover' })).toBeInTheDocument()
    expect(screen.getByLabelText('Choose a cover image')).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp')
    expect(screen.queryByRole('button', { name: 'Reset cover' })).not.toBeInTheDocument()
    expect(savedPatients()).toEqual(records)
  })

  it('accepts a decoded cover, retains it through role changes and demo navigation, and resets on remount', async () => {
    const { pending, revoke } = mockCoverImages()
    const user = userEvent.setup()
    const view = render(<App />)
    const storage = { ...localStorage }
    await user.upload(screen.getByLabelText('Choose a cover image'), new File(['synthetic photo'], 'clinic.jpg', { type: 'image/jpeg' }))
    expect(hero()).toHaveAttribute('src', '/images/clinic-hero.jpg')
    fireEvent.load(pending[0])
    expect(hero()).toHaveAttribute('src', 'blob:synthetic-cover-1')
    expect(screen.getByRole('status')).toHaveTextContent(/Cover updated/)
    await user.click(screen.getByRole('button', { name: 'Patient' }))
    expect(hero()).toHaveAttribute('src', 'blob:synthetic-cover-1')
    await user.click(screen.getByRole('button', { name: 'Explore demo workspace' }))
    expect(revoke).not.toHaveBeenCalledWith('blob:synthetic-cover-1')
    await user.click(screen.getByRole('button', { name: 'Log in as' }))
    expect(hero()).toHaveAttribute('src', 'blob:synthetic-cover-1')
    expect(screen.getByRole('button', { name: 'Reset cover' })).toBeInTheDocument()
    expect({ ...localStorage }).toEqual(storage)
    expect(sessionStorage.length).toBe(0)
    view.unmount()
    expect(revoke).toHaveBeenCalledWith('blob:synthetic-cover-1')
    render(<App />)
    expect(hero()).toHaveAttribute('src', '/images/clinic-hero.jpg')
  })

  it.each([
    ['unsupported', new File(['synthetic text'], 'cover.txt', { type: 'text/plain' })],
    ['SVG', new File(['<svg />'], 'cover.svg', { type: 'image/svg+xml' })],
    ['oversized', new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.jpg', { type: 'image/jpeg' })],
  ])('rejects an %s cover without allocating a preview or changing the current image', async (_case, file) => {
    const { create } = mockCoverImages()
    const user = userEvent.setup({ applyAccept: false })
    render(<App />)
    const storage = { ...localStorage }
    await user.upload(screen.getByLabelText('Choose a cover image'), file)
    expect(screen.getByRole('alert')).toHaveTextContent(/image|PNG|JPG|JPEG|5 MB|5MB/i)
    expect(hero()).toHaveAttribute('src', '/images/clinic-hero.jpg')
    expect(create).not.toHaveBeenCalled()
    expect({ ...localStorage }).toEqual(storage)
  })

  it('accepts the size boundary, replaces and resets covers, and releases discarded image URLs', async () => {
    const { pending, revoke } = mockCoverImages()
    const user = userEvent.setup()
    render(<App />)
    const chooser = screen.getByLabelText('Choose a cover image')
    await user.type(screen.getByLabelText('Email address'), 'synthetic@example.test')
    await user.type(screen.getByLabelText('Password'), 'Synthetic-only-password')
    await user.upload(chooser, new File([new Uint8Array(5 * 1024 * 1024)], 'boundary.webp', { type: 'image/webp' }))
    fireEvent.load(pending[0])
    expect(hero()).toHaveAttribute('src', 'blob:synthetic-cover-1')
    await user.upload(chooser, new File(['replacement photo'], 'replacement.png', { type: 'image/png' }))
    expect(hero()).toHaveAttribute('src', 'blob:synthetic-cover-1')
    fireEvent.load(pending[1])
    expect(hero()).toHaveAttribute('src', 'blob:synthetic-cover-2')
    expect(revoke).toHaveBeenCalledWith('blob:synthetic-cover-1')
    await user.click(screen.getByRole('button', { name: 'Reset cover' }))
    expect(hero()).toHaveAttribute('src', '/images/clinic-hero.jpg')
    expect(revoke).toHaveBeenCalledWith('blob:synthetic-cover-2')
    expect(screen.queryByRole('button', { name: 'Reset cover' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Email address')).toHaveValue('synthetic@example.test')
    expect(screen.getByLabelText('Password')).toHaveValue('Synthetic-only-password')
  })

  it('rejects a corrupt image without replacing the accepted cover and ignores a cancelled selection', async () => {
    const { pending, create, revoke } = mockCoverImages()
    const user = userEvent.setup()
    render(<App />)
    const chooser = screen.getByLabelText('Choose a cover image')
    await user.upload(chooser, new File(['photo'], 'valid.jpg', { type: 'image/jpeg' }))
    fireEvent.load(pending[0])
    await user.upload(chooser, new File(['corrupt image'], 'corrupt.png', { type: 'image/png' }))
    fireEvent.error(pending[1])
    expect(screen.getByRole('alert')).toHaveTextContent(/image|read|load/i)
    expect(hero()).toHaveAttribute('src', 'blob:synthetic-cover-1')
    expect(revoke).toHaveBeenCalledWith('blob:synthetic-cover-2')
    expect(revoke).not.toHaveBeenCalledWith('blob:synthetic-cover-1')
    fireEvent.change(chooser, { target: { files: [] } })
    expect(create).toHaveBeenCalledTimes(2)
    expect(hero()).toHaveAttribute('src', 'blob:synthetic-cover-1')
  })

  it('keeps the latest chosen cover when earlier image decoding finishes late', async () => {
    const { pending, revoke } = mockCoverImages()
    const user = userEvent.setup()
    render(<App />)
    const chooser = screen.getByLabelText('Choose a cover image')
    await user.upload(chooser, new File(['first photo'], 'first.jpg', { type: 'image/jpeg' }))
    await user.upload(chooser, new File(['second photo'], 'second.jpg', { type: 'image/jpeg' }))
    fireEvent.load(pending[1])
    fireEvent.load(pending[0])
    expect(hero()).toHaveAttribute('src', 'blob:synthetic-cover-2')
    expect(revoke).toHaveBeenCalledWith('blob:synthetic-cover-1')
  })
})

type RegistrationDraft = { name?: string; birthDate?: string; sex?: string; status?: string; email?: string }

async function submitRegistration(user: ReturnType<typeof userEvent.setup>, draft: RegistrationDraft) {
  renderDemo()
  await user.click(screen.getByRole('button', { name: 'New walk-in' }))
  const dialog = within(screen.getByRole('dialog', { name: 'New walk-in patient' }))
  if (draft.name) await user.type(dialog.getByRole('textbox', { name: /Patient name/ }), draft.name)
  if (draft.birthDate) fireEvent.change(dialog.getByLabelText('Date of birth'), { target: { value: draft.birthDate } })
  if (draft.sex) await user.selectOptions(dialog.getByRole('combobox', { name: /Sex/ }), draft.sex)
  if (draft.status) await user.selectOptions(dialog.getByRole('combobox', { name: /Allergy status/ }), draft.status)
  if (draft.email) await user.type(dialog.getByRole('textbox', { name: /Email address/ }), draft.email)
  fireEvent.submit(dialog.getByRole('button', { name: 'Register & open chart' }).closest('form')!)
}

async function generateQueueAndPreview(user: ReturnType<typeof userEvent.setup>) {
  renderDemo()
  await openQueue(user)
  await user.click(screen.getByRole('button', { name: 'Generate today’s QR' }))
  await screen.findByAltText('QR code for today’s patient check-in')
  await user.click(screen.getByRole('button', { name: 'Preview patient check-in' }))
}

describe('SRS scenario 2: invalid registration never creates a chart', () => {
  it.each([
    ['a blank name', { birthDate: '1995-04-03', sex: 'Female', status: 'none' }, 'Enter the patient’s name to continue.'],
    ['a missing date of birth', { name: 'Carla Diaz', sex: 'Female', status: 'none' }, 'Enter the patient’s date of birth.'],
    ['a missing sex', { name: 'Carla Diaz', birthDate: '1995-04-03', status: 'none' }, 'Select the patient’s sex or choose not to disclose.'],
    ['a missing allergy status', { name: 'Carla Diaz', birthDate: '1995-04-03', sex: 'Female' }, 'Record an allergy status before continuing.'],
    ['a malformed email address', { name: 'Carla Diaz', birthDate: '1995-04-03', sex: 'Female', status: 'none', email: 'carla-at-example' }, 'Enter a valid email address or leave it blank.'],
  ])('rejects %s without creating a chart', async (_label, draft, message) => {
    const user = userEvent.setup()
    await submitRegistration(user, draft)
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(savedPatients()).toHaveLength(2)
    expect(screen.getByRole('dialog', { name: 'New walk-in patient' })).toBeInTheDocument()
  })

  it('accepts a well-formed email address and stores it on the new chart', async () => {
    const user = userEvent.setup()
    await submitRegistration(user, { name: 'Carla Diaz', birthDate: '1995-04-03', sex: 'Female', status: 'none', email: 'carla@example.test' })
    expect(savedPatients()).toHaveLength(3)
    expect(savedPatients()[0]).toMatchObject({ name: 'Carla Diaz', email: 'carla@example.test' })
  })

  it('cancel closes the registration without creating a record', async () => {
    const user = userEvent.setup()
    renderDemo()
    await user.click(screen.getByRole('button', { name: 'New walk-in' }))
    const dialog = within(screen.getByRole('dialog', { name: 'New walk-in patient' }))
    await user.type(dialog.getByRole('textbox', { name: /Patient name/ }), 'Carla Diaz')
    fireEvent.change(dialog.getByLabelText('Date of birth'), { target: { value: '1995-04-03' } })
    await user.click(dialog.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(savedPatients()).toHaveLength(2)
    expect(savedPatients().map((item) => item.name)).not.toContain('Carla Diaz')
  })
})

describe('SRS scenario 5: check-in input and paused intake create no ticket or chart', () => {
  it.each([
    ['a phone number without digits', { phone: 'call me' }],
    ['a future date of birth', { birthDate: '2999-01-01' }],
    ['a missing sex', { sex: '' }],
    ['a known allergy without details', { allergyStatus: 'known', allergy: '   ' }],
  ])('rejects a check-in with %s without issuing a ticket or creating a chart', async (_label, overrides) => {
    const user = userEvent.setup()
    await generateQueueAndPreview(user)
    const values = { name: 'Dana Invalid', phone: '09171230000', birthDate: '1990-05-10', sex: 'Female', allergyStatus: 'none', allergy: '', ...overrides }
    await user.type(screen.getByRole('textbox', { name: /Full name/ }), values.name)
    await user.type(screen.getByRole('textbox', { name: /Phone number/ }), values.phone)
    fireEvent.change(document.querySelector<HTMLInputElement>('input[type="date"]')!, { target: { value: values.birthDate } })
    if (values.sex) await user.selectOptions(screen.getByRole('combobox', { name: /Sex/ }), values.sex)
    await user.selectOptions(screen.getByRole('combobox', { name: /Allergy status/ }), values.allergyStatus)
    if (values.allergyStatus === 'known') await user.type(screen.getByRole('textbox', { name: /Known allergies/ }), values.allergy)
    fireEvent.submit(screen.getByRole('button', { name: 'Get my queue number' }).closest('form')!)
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your name, phone, valid date of birth, sex, and allergy details when known.')
    expect(savedQueue().entries).toHaveLength(0)
    expect(savedPatients()).toHaveLength(2)
  })

  it('pausing intake shows no form, issues no ticket, and reopening restores the form', async () => {
    const user = userEvent.setup()
    renderDemo()
    await openQueue(user)
    await user.click(screen.getByRole('button', { name: 'Generate today’s QR' }))
    await user.click(screen.getByRole('button', { name: 'Pause check-in' }))
    await user.click(screen.getByRole('button', { name: 'Preview patient check-in' }))
    expect(screen.getByRole('status')).toHaveTextContent('Check-in is paused')
    expect(screen.queryByRole('textbox', { name: /Full name/ })).not.toBeInTheDocument()
    expect(savedQueue().entries).toHaveLength(0)
    expect(savedPatients()).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Back to clinic' }))
    await user.click(screen.getByRole('button', { name: 'Reopen check-in' }))
    await user.click(screen.getByRole('button', { name: 'Preview patient check-in' }))
    expect(screen.getByRole('textbox', { name: /Full name/ })).toBeInTheDocument()
  })
})

describe('SRS APT-01: appointment date validation', () => {
  it('rejects a booking without a valid date and keeps the existing appointment intact', async () => {
    localStorage.setItem(storageKeys.appointments, JSON.stringify([appointment({ id: 'appointment-keep', time: '11:00' })]))
    const user = userEvent.setup()
    renderDemo()
    await user.click(screen.getByRole('button', { name: 'Schedule appointment' }))
    const dialog = screen.getByRole('dialog', { name: 'Book an appointment' })
    fireEvent.change(within(dialog).getByLabelText(/^Date/), { target: { value: '' } })
    fireEvent.submit(dialog.querySelector('form')!)
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a valid appointment date.')
    const stored = JSON.parse(localStorage.getItem(storageKeys.appointments)!)
    expect(stored.map((item: { id: string }) => item.id)).toEqual(['appointment-keep'])
  })
})

describe('SRS scenario 9: prescription print preview is labelled as a demo draft', () => {
  it('states draft status, the prescribing sample identity and the patient on the printed prescription', async () => {
    const user = userEvent.setup()
    renderDemo()
    await openChart(user)
    await prescriptionTab(user)
    await user.type(screen.getByRole('textbox', { name: /Medication name/ }), 'Demo medication')
    await user.type(screen.getByRole('textbox', { name: 'Directions for use' }), 'Synthetic test directions')
    await user.click(screen.getByRole('button', { name: 'Add to chart' }))
    const preview = document.getElementById('print-prescription')!
    expect(preview).toHaveTextContent('DEMO DRAFT — not a finalized prescription')
    expect(preview).toHaveTextContent('Rx · DRAFT')
    expect(preview).toHaveTextContent('Dr. Maya Reyes (sample clinician)')
    expect(preview).toHaveTextContent('Sample identity · not authenticated')
    expect(preview).toHaveTextContent('Alice Santos')
  })
})

describe('daily queue consultation state', () => {
  const readyEntry = (id: string, number: string, name: string, patientId: string) => ({
    id, number, name, phone: '09171234567', joinedAt: new Date().toISOString(), status: 'waiting' as const,
    patientId, birthDate: '1990-05-10', reportedAllergyStatus: 'none' as const, reportedAllergy: '', stage: 'ready' as const,
  })

  it('allows only one consultation at a time and keeps a set-aside patient ready for a later start', async () => {
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ entries: [readyEntry('q-1', '001', 'Alice Santos', 'patient-a'), readyEntry('q-2', '002', 'Bea Cruz', 'patient-b')] })))
    const user = userEvent.setup()
    renderDemo()
    await openQueue(user)
    await user.click(screen.getAllByRole('button', { name: 'Start consultation' })[0])
    expect(screen.getByRole('dialog', { name: 'Complete visit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start consultation' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Continue later' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(savedQueue().entries.map((entry) => entry.stage)).toEqual(['ready', 'ready'])
    const starts = screen.getAllByRole('button', { name: 'Start consultation' })
    expect(starts).toHaveLength(2)
    starts.forEach((button) => expect(button).toBeEnabled())
  })

  it('returns a set-aside called patient to the ready list as waiting, so the next ticket can be called', async () => {
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ entries: [
      { ...readyEntry('q-1', '001', 'Alice Santos', 'patient-a'), status: 'called' as const },
      { ...readyEntry('q-2', '002', 'Bea Cruz', 'patient-b'), stage: undefined, status: 'waiting' as const },
    ] })))
    const user = userEvent.setup()
    renderDemo()
    await openQueue(user)
    await user.click(screen.getAllByRole('button', { name: 'Start consultation' })[0])
    await user.click(screen.getByRole('button', { name: 'Continue later' }))
    expect(savedQueue().entries[0]).toMatchObject({ status: 'waiting', stage: 'ready' })
    expect(screen.getByText('Being seen').closest('.queue-summary-card')).toHaveTextContent('0')
    expect(screen.getByRole('button', { name: 'Call next' })).toBeEnabled()
  })
})

describe('SRS QUE-01: rotating the daily QR', () => {
  it('replaces the QR, keeps today’s tickets and pause state, and rejects the previous link', async () => {
    const user = userEvent.setup()
    const view = renderDemo()
    await openQueue(user)
    await user.click(screen.getByRole('button', { name: 'Generate today’s QR' }))
    await joinPreview(user, 'Alice Santos', '09171234567')
    await user.click(screen.getByRole('button', { name: 'Back to clinic' }))
    const previousToken = savedQueue().token
    await user.click(screen.getByRole('button', { name: 'Pause check-in' }))
    await user.click(screen.getByRole('button', { name: 'Rotate QR' }))
    await user.click(screen.getByRole('button', { name: 'Replace QR code' }))
    const rotated = savedQueue()
    expect(rotated.token).not.toBe(previousToken)
    expect(rotated.isOpen).toBe(false)
    expect(rotated.entries).toHaveLength(1)
    view.unmount()

    window.history.replaceState({}, '', `/?queue=${previousToken}`)
    renderDemo()
    expect(screen.getByRole('alert')).toHaveTextContent('This check-in link isn’t connected')
    cleanup()

    window.history.replaceState({}, '', `/?queue=${rotated.token}`)
    renderDemo()
    expect(screen.getByRole('status')).toHaveTextContent('Check-in is paused')
  })

  it('keeps the current QR when rotation is cancelled', async () => {
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue()))
    const user = userEvent.setup()
    renderDemo()
    await openQueue(user)
    await user.click(screen.getByRole('button', { name: 'Rotate QR' }))
    await user.click(screen.getByRole('button', { name: 'Keep current QR' }))
    expect(savedQueue().token).toBe('test-daily-token')
    expect(screen.queryByRole('button', { name: 'Replace QR code' })).not.toBeInTheDocument()
  })
})

describe('SRS ALL-01 and TRI-01: documented allergies are reconciled, never silently removed', () => {
  const triageDone = { complaint: 'Headache', notes: '', bloodPressure: '', weight: '', temperature: '' }
  const allergyEntry = (overrides: Record<string, unknown> = {}) => ({
    id: 'q-allergy', number: '001', name: 'Alice Santos', phone: '09171234567', joinedAt: new Date().toISOString(),
    status: 'waiting' as const, patientId: 'patient-a', stage: 'triage' as const, reportedAllergyStatus: 'none' as const, reportedAllergy: '', ...overrides,
  })
  const documentedPatient = () => [patient({ allergy: 'Penicillin', allergyStatus: 'known' }), secondPatient()]

  async function recordTriage(user: ReturnType<typeof userEvent.setup>, status: string, details?: string) {
    await user.click(screen.getByRole('button', { name: 'Record triage' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Record triage' }))
    await user.type(dialog.getByLabelText(/Chief complaint/), 'Headache')
    await user.selectOptions(dialog.getByRole('combobox', { name: /Confirmed allergy status/ }), status)
    if (details) await user.type(dialog.getByRole('textbox', { name: /Confirmed allergies/ }), details)
    await user.click(dialog.getByRole('checkbox', { name: /verified the allergy status/ }))
    await user.click(dialog.getByRole('button', { name: 'Save triage & hand off' }))
  }

  it('keeps a documented allergy when triage reports none, and records the conflict for the doctor', async () => {
    localStorage.setItem(storageKeys.patients, JSON.stringify(documentedPatient()))
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ entries: [allergyEntry()] })))
    const user = userEvent.setup()
    render(<App />)
    await signIntoDemo(user, 'Attendant')
    await recordTriage(user, 'none')
    expect(savedPatients().find((item) => item.id === 'patient-a')).toMatchObject({ allergyStatus: 'known', allergy: 'Penicillin' })
    expect(savedQueue().entries[0]).toMatchObject({ stage: 'ready', allergyDiscrepancy: { reportedStatus: 'none', documentedAllergy: 'Penicillin' } })
  })

  it('adds newly confirmed allergies to the documented list without repeating or replacing it', async () => {
    localStorage.setItem(storageKeys.patients, JSON.stringify(documentedPatient()))
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ entries: [allergyEntry()] })))
    const user = userEvent.setup()
    render(<App />)
    await signIntoDemo(user, 'Attendant')
    await recordTriage(user, 'known', 'Latex, penicillin')
    const chart = savedPatients().find((item) => item.id === 'patient-a')!
    expect(chart).toMatchObject({ allergyStatus: 'known', allergy: 'Penicillin, Latex' })
    expect(savedQueue().entries[0].allergyDiscrepancy).toBeUndefined()
  })

  it('requires the doctor to keep or remove a documented allergy before the visit can be saved', async () => {
    localStorage.setItem(storageKeys.patients, JSON.stringify(documentedPatient()))
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ entries: [allergyEntry({ stage: 'ready', triage: triageDone, allergyDiscrepancy: { reportedStatus: 'none', documentedAllergy: 'Penicillin' } })] })))
    const user = userEvent.setup()
    renderDemo()
    await openQueue(user)
    await user.click(screen.getByRole('button', { name: 'Start consultation' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Complete visit' }))
    await user.type(dialog.getByRole('textbox', { name: /Assessment \/ diagnosis/ }), 'Tension headache')
    await user.type(dialog.getByRole('textbox', { name: /Consultation notes/ }), 'Rest advised')
    await user.click(dialog.getByRole('checkbox', { name: /reviewed the allergy information/ }))
    expect(dialog.getByRole('button', { name: 'Save visit to patient history' })).toBeDisabled()
    await user.click(dialog.getByRole('radio', { name: /Keep documented allergy/ }))
    expect(dialog.getByRole('button', { name: 'Save visit to patient history' })).toBeEnabled()
    await user.click(dialog.getByRole('button', { name: 'Save visit to patient history' }))
    const chart = savedPatients().find((item) => item.id === 'patient-a')!
    expect(chart).toMatchObject({ allergyStatus: 'known', allergy: 'Penicillin' })
    expect(chart.records[0].allergyReview).toEqual({ decision: 'kept', reportedStatus: 'none', documentedAllergy: 'Penicillin', reason: '' })
  })

  it('removes a documented allergy only with a recorded reason', async () => {
    localStorage.setItem(storageKeys.patients, JSON.stringify(documentedPatient()))
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ entries: [allergyEntry({ stage: 'ready', triage: triageDone, allergyDiscrepancy: { reportedStatus: 'none', documentedAllergy: 'Penicillin' } })] })))
    const user = userEvent.setup()
    renderDemo()
    await openQueue(user)
    await user.click(screen.getByRole('button', { name: 'Start consultation' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Complete visit' }))
    await user.type(dialog.getByRole('textbox', { name: /Assessment \/ diagnosis/ }), 'Tension headache')
    await user.type(dialog.getByRole('textbox', { name: /Consultation notes/ }), 'Rest advised')
    await user.click(dialog.getByRole('checkbox', { name: /reviewed the allergy information/ }))
    await user.click(dialog.getByRole('radio', { name: /Remove documented allergy/ }))
    expect(dialog.getByRole('button', { name: 'Save visit to patient history' })).toBeDisabled()
    await user.type(dialog.getByRole('textbox', { name: /Reason for removing/ }), 'Penicillin ruled out with patient history')
    await user.click(dialog.getByRole('button', { name: 'Save visit to patient history' }))
    const chart = savedPatients().find((item) => item.id === 'patient-a')!
    expect(chart).toMatchObject({ allergyStatus: 'none', allergy: 'No known allergies' })
    expect(chart.records[0].allergyReview).toEqual({ decision: 'removed', reportedStatus: 'none', documentedAllergy: 'Penicillin', reason: 'Penicillin ruled out with patient history' })
  })

  async function openUntriagedConsultation(user: ReturnType<typeof userEvent.setup>, patients: unknown[]) {
    localStorage.setItem(storageKeys.patients, JSON.stringify(patients))
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ entries: [allergyEntry({ stage: 'ready', reportedAllergyStatus: 'known', reportedAllergy: 'Latex' })] })))
    renderDemo()
    await openQueue(user)
    await user.click(screen.getByRole('button', { name: 'Start consultation' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Complete visit' }))
    await user.type(dialog.getByRole('textbox', { name: /Assessment \/ diagnosis/ }), 'Tension headache')
    await user.type(dialog.getByRole('textbox', { name: /Consultation notes/ }), 'Rest advised')
    await user.click(dialog.getByRole('checkbox', { name: /reviewed the allergy information/ }))
    return dialog
  }

  it('without triage the doctor must confirm allergies before saving, and the confirmation reaches the chart', async () => {
    const user = userEvent.setup()
    const dialog = await openUntriagedConsultation(user, [patient(), secondPatient()])
    expect(dialog.getByText(/known allergies: Latex/)).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'Save visit to patient history' })).toBeDisabled()
    await user.selectOptions(dialog.getByRole('combobox', { name: /Confirmed allergy status/ }), 'known')
    expect(dialog.getByRole('button', { name: 'Save visit to patient history' })).toBeDisabled()
    await user.type(dialog.getByRole('textbox', { name: /Confirmed allergies/ }), 'Latex')
    await user.click(dialog.getByRole('button', { name: 'Save visit to patient history' }))
    expect(savedPatients().find((item) => item.id === 'patient-a')).toMatchObject({ allergyStatus: 'known', allergy: 'Latex' })
    expect(savedQueue().entries[0].stage).toBe('complete')
  })

  it('without triage, a confirmed "none" cannot erase a documented allergy: the doctor must keep or remove it with the visit', async () => {
    const user = userEvent.setup()
    const dialog = await openUntriagedConsultation(user, documentedPatient())
    await user.selectOptions(dialog.getByRole('combobox', { name: /Confirmed allergy status/ }), 'none')
    expect(dialog.getByText('Allergy difference to review')).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'Save visit to patient history' })).toBeDisabled()
    expect(savedPatients().find((item) => item.id === 'patient-a')).toMatchObject({ allergyStatus: 'known', allergy: 'Penicillin' })
    await user.click(dialog.getByRole('radio', { name: /Keep documented allergy/ }))
    await user.click(dialog.getByRole('button', { name: 'Save visit to patient history' }))
    const chart = savedPatients().find((item) => item.id === 'patient-a')!
    expect(chart).toMatchObject({ allergyStatus: 'known', allergy: 'Penicillin' })
    expect(chart.records[0].allergyReview).toEqual({ decision: 'kept', reportedStatus: 'none', documentedAllergy: 'Penicillin', reason: '' })
  })

  it('without triage, the doctor can add a new allergy to the documented list without a review', async () => {
    const user = userEvent.setup()
    const dialog = await openUntriagedConsultation(user, documentedPatient())
    await user.selectOptions(dialog.getByRole('combobox', { name: /Confirmed allergy status/ }), 'known')
    await user.type(dialog.getByRole('textbox', { name: /Confirmed allergies/ }), 'Latex')
    expect(dialog.queryByText('Allergy difference to review')).not.toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: 'Save visit to patient history' }))
    const chart = savedPatients().find((item) => item.id === 'patient-a')!
    expect(chart).toMatchObject({ allergyStatus: 'known', allergy: 'Penicillin, Latex' })
    expect(chart.records[0].allergyReview).toBeUndefined()
  })

  it('does not ask the doctor to confirm allergies again once an attendant did at triage', async () => {
    localStorage.setItem(storageKeys.patients, JSON.stringify([patient(), secondPatient()]))
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ entries: [allergyEntry({ stage: 'ready', triage: triageDone })] })))
    const user = userEvent.setup()
    renderDemo()
    await openQueue(user)
    await user.click(screen.getByRole('button', { name: 'Start consultation' }))
    expect(screen.queryByRole('combobox', { name: /Confirmed allergy status/ })).not.toBeInTheDocument()
  })

  it('lets the doctor start any waiting patient, not only the one who arrived first', async () => {
    localStorage.setItem(storageKeys.patients, JSON.stringify([patient(), secondPatient()]))
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ entries: [
      allergyEntry({ id: 'q-first', number: '001', reportedReason: 'Routine check-up' }),
      allergyEntry({ id: 'q-urgent', number: '002', name: 'Bea Cruz', patientId: 'patient-b', reportedReason: 'Chest tightness', reportedSymptoms: 'Since this morning' }),
    ].map((item) => ({ ...item, stage: 'ready' })) })))
    const user = userEvent.setup()
    renderDemo()
    await openQueue(user)
    expect(screen.getByText(/Reported: Chest tightness — Since this morning/)).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Start consultation' })[1])
    expect(savedQueue().entries.map((item) => item.stage)).toEqual(['ready', 'consulting'])
    expect(screen.getByRole('dialog', { name: 'Complete visit' })).toHaveTextContent('Bea Cruz')
  })
})

async function fillCheckIn(user: ReturnType<typeof userEvent.setup>, name: string, reason = '', symptoms = '') {
  await user.type(screen.getByRole('textbox', { name: /Full name/ }), name)
  await user.type(screen.getByRole('textbox', { name: /Phone number/ }), '09171234567')
  fireEvent.change(document.querySelector<HTMLInputElement>('input[type="date"]')!, { target: { value: '1990-05-10' } })
  await user.selectOptions(screen.getByRole('combobox', { name: /Sex/ }), 'Female')
  await user.selectOptions(screen.getByRole('combobox', { name: /Allergy status/ }), 'none')
  if (reason) await user.type(screen.getByRole('textbox', { name: /What brings you in today/ }), reason)
  if (symptoms) await user.type(screen.getByRole('textbox', { name: /How are you feeling/ }), symptoms)
}

describe('SRS INT-01 and QUE-01: closing time, ending and reopening intake', () => {
  it('the doctor sets a closing time when generating the QR, and check-in is refused once it has passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 9, 16, 59, 0))
    const user = userEvent.setup()
    renderDemo()
    await openQueue(user)
    await user.selectOptions(screen.getByRole('combobox', { name: /Check-in closes at/ }), '17:00')
    await user.click(screen.getByRole('button', { name: 'Generate today’s QR' }))
    expect(savedQueue().closesAt).toBe('17:00')
    await user.click(screen.getByRole('button', { name: 'Preview patient check-in' }))
    await fillCheckIn(user, 'Late Arrival')
    vi.setSystemTime(new Date(2026, 10, 9, 17, 1, 0))
    await user.click(screen.getByRole('button', { name: 'Get my queue number' }))
    expect(screen.getByRole('status')).toHaveTextContent('Check-in closed at 17:00')
    expect(screen.queryByRole('button', { name: 'Get my queue number' })).not.toBeInTheDocument()
    expect(savedQueue().entries).toHaveLength(0)
    expect(savedPatients()).toHaveLength(2)
  })

  it('the doctor ends today’s intake, which turns patients away until the doctor reopens it', async () => {
    const user = userEvent.setup()
    renderDemo()
    await openQueue(user)
    await user.click(screen.getByRole('button', { name: 'Generate today’s QR' }))
    await user.click(screen.getByRole('button', { name: 'End today’s intake' }))
    await user.click(screen.getByRole('button', { name: 'End intake for today' }))
    expect(savedQueue().ended).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Preview patient check-in' }))
    expect(screen.getByRole('status')).toHaveTextContent('Check-in for today has ended')
    expect(screen.queryByRole('button', { name: 'Get my queue number' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to clinic' }))
    await user.click(screen.getByRole('button', { name: 'Reopen intake' }))
    expect(savedQueue().ended).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Preview patient check-in' }))
    expect(screen.getByRole('button', { name: 'Get my queue number' })).toBeEnabled()
  })

  it('reopening an ended intake does not claim check-in is open while it is still paused or past its closing time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 9, 17, 30, 0))
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ ended: true, closesAt: '17:00' })))
    const user = userEvent.setup()
    renderDemo()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', { name: /^Daily queue/ }))
    await user.click(screen.getByRole('button', { name: 'Reopen intake' }))
    expect(screen.getByText(/Intake reopened, but the closing time has passed/)).toBeInTheDocument()
    expect(screen.queryByText('Intake reopened. Patients can check in again.')).not.toBeInTheDocument()
    expect(savedQueue().ended).toBe(false)
  })

  it('reopening an ended intake that staff had paused says check-in is still paused', async () => {
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ ended: true, isOpen: false })))
    const user = userEvent.setup()
    renderDemo()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', { name: /^Daily queue/ }))
    await user.click(screen.getByRole('button', { name: 'Reopen intake' }))
    expect(screen.getByText(/Intake reopened, but check-in is still paused/)).toBeInTheDocument()
  })

  it('the queue page moves to closed at the closing time without anyone pressing a button', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date(2026, 10, 9, 16, 50, 0))
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ closesAt: '17:00' })))
    renderDemo()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', { name: /^Daily queue/ }))
    expect(screen.getByText('Accepting check-ins')).toBeInTheDocument()
    act(() => {
      vi.setSystemTime(new Date(2026, 10, 9, 17, 0, 30))
      vi.advanceTimersByTime(30_000)
    })
    expect(screen.getByText('Closed at 17:00')).toBeInTheDocument()
  })

  it('the attendant can pause and resume intake', async () => {
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue()))
    const user = userEvent.setup()
    render(<App />)
    await signIntoDemo(user, 'Attendant')
    await user.click(screen.getByRole('button', { name: 'Pause check-in' }))
    expect(screen.getByRole('button', { name: 'Resume check-in' })).toBeInTheDocument()
    expect(savedQueue().isOpen).toBe(false)
  })

  it('the attendant cannot end or reopen an ended day’s intake', async () => {
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ ended: true })))
    const user = userEvent.setup()
    render(<App />)
    await signIntoDemo(user, 'Attendant')
    expect(screen.getByText('Intake is closed for today. Only the doctor can reopen it.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Resume check-in|Pause check-in|Reopen intake/ })).not.toBeInTheDocument()
  })
})

describe('SRS INT-02: what the patient reports at check-in', () => {
  it('captures the reason and symptoms typed at check-in, and shows them to the doctor in the queue and the visit', async () => {
    const user = userEvent.setup()
    renderDemo()
    await openQueue(user)
    await user.click(screen.getByRole('button', { name: 'Generate today’s QR' }))
    await user.click(screen.getByRole('button', { name: 'Preview patient check-in' }))
    await fillCheckIn(user, 'Alice Santos', 'Headache since yesterday', 'Throbbing pain behind the eyes, no fever')
    await user.click(screen.getByRole('button', { name: 'Get my queue number' }))
    expect(savedQueue().entries[0]).toMatchObject({ stage: 'ready', reportedReason: 'Headache since yesterday', reportedSymptoms: 'Throbbing pain behind the eyes, no fever' })
    await user.click(screen.getByRole('button', { name: 'Back to clinic' }))

    expect(screen.getByText(/Reported: Headache since yesterday — Throbbing pain behind the eyes, no fever/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start consultation' }))
    const visit = within(screen.getByRole('dialog', { name: 'Complete visit' }))
    expect(visit.getByText('Headache since yesterday')).toBeInTheDocument()
    expect(visit.getByRole('textbox', { name: 'Symptoms' })).toHaveValue('Throbbing pain behind the eyes, no fever')
  })

  it('carries the patient’s reported reason into the optional triage form when an attendant records it', async () => {
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ entries: [{
      id: 'q-words', number: '001', name: 'Alice Santos', phone: '09171234567', joinedAt: new Date().toISOString(),
      status: 'waiting', patientId: 'patient-a', stage: 'ready', reportedReason: 'Headache since yesterday', reportedSymptoms: 'Throbbing pain',
    }] })))
    const user = userEvent.setup()
    render(<App />)
    await signIntoDemo(user, 'Attendant')
    await user.click(screen.getByRole('button', { name: 'Record triage' }))
    const triage = within(screen.getByRole('dialog', { name: 'Record triage' }))
    expect(triage.getByLabelText(/Chief complaint/)).toHaveValue('Headache since yesterday')
    expect(triage.getByText(/Throbbing pain/)).toBeInTheDocument()
    await user.selectOptions(triage.getByRole('combobox', { name: /Confirmed allergy status/ }), 'none')
    await user.click(triage.getByRole('checkbox', { name: /confirmed their identity/ }))
    await user.click(triage.getByRole('button', { name: 'Save triage & hand off' }))
    expect(screen.queryByRole('button', { name: 'Record triage' })).not.toBeInTheDocument()
    expect(savedQueue().entries[0].triage?.complaint).toBe('Headache since yesterday')
  })

  it('does not require a chief complaint when an attendant records optional triage', async () => {
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ entries: [{
      id: 'q-vitals', number: '001', name: 'Alice Santos', phone: '09171234567', joinedAt: new Date().toISOString(),
      status: 'waiting', patientId: 'patient-a', stage: 'ready',
    }] })))
    const user = userEvent.setup()
    render(<App />)
    await signIntoDemo(user, 'Attendant')
    expect(screen.getByText('Waiting for the doctor')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Record triage' }))
    const triage = within(screen.getByRole('dialog', { name: 'Record triage' }))
    expect(triage.getByLabelText(/Chief complaint/)).not.toBeRequired()
    await user.type(triage.getByLabelText(/Blood pressure/), '120/80')
    await user.selectOptions(triage.getByRole('combobox', { name: /Confirmed allergy status/ }), 'none')
    await user.click(triage.getByRole('checkbox', { name: /confirmed their identity/ }))
    await user.click(triage.getByRole('button', { name: 'Save triage & hand off' }))
    expect(savedQueue().entries[0].triage).toMatchObject({ complaint: '', bloodPressure: '120/80' })
  })

  it('lets the patient leave the reason and symptoms blank', async () => {
    const user = userEvent.setup()
    renderDemo()
    await openQueue(user)
    await user.click(screen.getByRole('button', { name: 'Generate today’s QR' }))
    await user.click(screen.getByRole('button', { name: 'Preview patient check-in' }))
    await fillCheckIn(user, 'Alice Santos')
    await user.click(screen.getByRole('button', { name: 'Get my queue number' }))
    expect(screen.getByRole('status')).toHaveTextContent('001')
    expect(savedQueue().entries[0].reportedReason).toBeUndefined()
    expect(savedQueue().entries[0].reportedSymptoms).toBeUndefined()
  })
})

describe('SRS QUE-04: priority lane for seniors and pediatric patients', () => {
  const waitingTicket = (overrides: Partial<QueueEntry>): QueueEntry => ({
    id: 'q-x', number: 'R-001', name: 'Alice Santos', phone: '09171234567', joinedAt: '2026-11-09T01:00:00.000Z',
    status: 'waiting' as const, patientId: 'patient-a', stage: 'ready' as const, lane: 'regular' as const, ...overrides,
  })

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 9, 9, 0, 0))
  })

  it('puts adults in the regular lane and seniors and children in the priority lane, numbering each lane on its own', async () => {
    const user = userEvent.setup()
    renderDemo()
    await openQueue(user)
    await user.click(screen.getByRole('button', { name: 'Generate today’s QR' }))
    await joinPreview(user, 'Adult Person', '09170000001', 'Female', '1990-05-10')
    expect(screen.getByRole('status')).toHaveTextContent('R-001')
    await user.click(screen.getByRole('button', { name: 'Back to clinic' }))
    await joinPreview(user, 'Senior Person', '09170000002', 'Female', '1950-01-01')
    expect(screen.getByRole('status')).toHaveTextContent('P-001')
    expect(screen.getByRole('status')).toHaveTextContent('Priority (senior & pediatric)')
    expect(screen.getByRole('status')).toHaveTextContent('Senior patients are seen first.')
    await user.click(screen.getByRole('button', { name: 'Back to clinic' }))
    await joinPreview(user, 'Child Person', '09170000003', 'Male', '2018-03-02')
    expect(screen.getByRole('status')).toHaveTextContent('P-002')
    await user.click(screen.getByRole('button', { name: 'Back to clinic' }))
    await joinPreview(user, 'Second Adult', '09170000004', 'Male', '1985-07-07')
    expect(screen.getByRole('status')).toHaveTextContent('R-002')
    expect(savedQueue().entries.map((entry) => [entry.number, entry.lane])).toEqual([['R-001', 'regular'], ['P-001', 'priority'], ['P-002', 'priority'], ['R-002', 'regular']])
  })

  it('treats the day someone turns 60 or 18 as the start of the new lane', async () => {
    const user = userEvent.setup()
    renderDemo()
    await openQueue(user)
    await user.click(screen.getByRole('button', { name: 'Generate today’s QR' }))
    await joinPreview(user, 'Turned Sixty', '09170000005', 'Female', '1966-11-09')
    expect(screen.getByRole('status')).toHaveTextContent('P-001')
    await user.click(screen.getByRole('button', { name: 'Back to clinic' }))
    await joinPreview(user, 'Almost Sixty', '09170000006', 'Female', '1966-11-10')
    expect(screen.getByRole('status')).toHaveTextContent('R-001')
    await user.click(screen.getByRole('button', { name: 'Back to clinic' }))
    await joinPreview(user, 'Almost Adult', '09170000007', 'Female', '2008-11-10')
    expect(screen.getByRole('status')).toHaveTextContent('P-002')
    await user.click(screen.getByRole('button', { name: 'Back to clinic' }))
    await joinPreview(user, 'Just Adult', '09170000008', 'Female', '2008-11-09')
    expect(screen.getByRole('status')).toHaveTextContent('R-002')
  })

  it('shows the doctor priority patients first and Call next follows that order, while any patient can still be started', async () => {
    localStorage.setItem(storageKeys.patients, JSON.stringify([patient(), secondPatient()]))
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ entries: [
      waitingTicket({ id: 'q-adult', number: 'R-001', name: 'Alice Santos', joinedAt: '2026-11-09T00:50:00.000Z' }),
      waitingTicket({ id: 'q-senior', number: 'P-001', name: 'Bea Cruz', patientId: 'patient-b', lane: 'priority', birthDate: '1950-01-01', joinedAt: '2026-11-09T00:55:00.000Z' }),
    ] })))
    const user = userEvent.setup()
    renderDemo()
    await openQueue(user)
    const rows = document.querySelectorAll('.queue-table-row')
    expect(rows[0]).toHaveTextContent('Bea Cruz')
    expect(rows[0]).toHaveTextContent('Senior')
    expect(rows[1]).toHaveTextContent('Alice Santos')
    await user.click(screen.getByRole('button', { name: 'Call next' }))
    expect(savedQueue().entries.map((entry) => entry.status)).toEqual(['waiting', 'called'])
  })

  it('tells a waiting patient the current number and how many people are ahead of them', async () => {
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ entries: [
      waitingTicket({ id: 'q-room', number: 'P-001', name: 'Someone In Room', patientId: 'patient-b', lane: 'priority', stage: 'consulting', status: 'called' }),
      waitingTicket({ id: 'q-p2', number: 'P-002', name: 'Waiting Senior', patientId: 'patient-b', lane: 'priority', joinedAt: '2026-11-09T00:51:00.000Z' }),
      waitingTicket({ id: 'q-p3', number: 'P-003', name: 'Waiting Child', patientId: 'patient-b', lane: 'priority', joinedAt: '2026-11-09T00:52:00.000Z' }),
    ] })))
    const user = userEvent.setup()
    renderDemo()
    await openQueue(user)
    await user.click(screen.getByRole('button', { name: 'Preview patient check-in' }))
    await user.type(screen.getByRole('textbox', { name: /Full name/ }), 'Adult Person')
    await user.type(screen.getByRole('textbox', { name: /Phone number/ }), '09170000001')
    fireEvent.change(document.querySelector<HTMLInputElement>('input[type="date"]')!, { target: { value: '1990-05-10' } })
    await user.selectOptions(screen.getByRole('combobox', { name: /Sex/ }), 'Female')
    await user.click(screen.getByRole('button', { name: 'Get my queue number' }))
    const board = within(screen.getByLabelText('Queue status'))
    expect(board.getByText('P-001')).toBeInTheDocument()
    expect(board.getByText('Regular (adult)')).toBeInTheDocument()
    expect(board.getByText('2 people are ahead of you.')).toBeInTheDocument()
  })

  it('tells the first patient in line they are next, while nobody is being served yet', async () => {
    const user = userEvent.setup()
    renderDemo()
    await openQueue(user)
    await user.click(screen.getByRole('button', { name: 'Generate today’s QR' }))
    await joinPreview(user, 'Adult Person', '09170000001', 'Female', '1990-05-10')
    expect(within(screen.getByLabelText('Queue status')).getByText('You are next.')).toBeInTheDocument()
    expect(within(screen.getByLabelText('Queue status')).getByText('No one yet')).toBeInTheDocument()
  })

  it('shows any patient the current number and how many are waiting, without names', async () => {
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ entries: [
      waitingTicket({ id: 'q-room', number: 'R-007', name: 'Private Name', stage: 'consulting', status: 'called' }),
      waitingTicket({ id: 'q-w1', number: 'R-008', name: 'Another Private Name' }),
    ] })))
    const user = userEvent.setup()
    render(<App />)
    await signIntoDemo(user, 'Patient')
    const summary = screen.getByLabelText('Today’s queue')
    expect(summary).toHaveTextContent('Now serving: R-007')
    expect(summary).toHaveTextContent('1 waiting')
    expect(screen.queryByText(/Private Name/)).not.toBeInTheDocument()
  })

  it('keeps older tickets without a lane working as regular tickets', async () => {
    localStorage.setItem(storageKeys.queue, JSON.stringify(queue({ entries: [{
      id: 'q-old', number: '001', name: 'Alice Santos', phone: '09171234567', joinedAt: '2026-11-09T00:50:00.000Z', status: 'waiting', patientId: 'patient-a', stage: 'ready',
    }] })))
    const user = userEvent.setup()
    renderDemo()
    await openQueue(user)
    expect(screen.getByRole('button', { name: 'Call next' })).toBeEnabled()
    expect(document.querySelector('.queue-lane-badge')).toBeNull()
  })
})

describe('SRS APT-07 to APT-09: online booking', () => {
  const tomorrow = '2026-11-10'
  const today = '2026-11-09'
  const sofia = () => patient({ id: 'p-1001', name: 'Sofia Reyes', initials: 'SR', patientNumber: 'PT-10482', phone: '0917-555-0142', email: 'sofia.reyes@example.test', birthDate: '1994-05-12' })
  const bookingRegion = () => within(screen.getByRole('region', { name: 'Book online' }))

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 9, 9, 0, 0))
  })

  async function openOnlineBookingFor(user: ReturnType<typeof userEvent.setup>, date: string) {
    renderDemo()
    await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', { name: /^Appointments/ }))
    const panel = within(screen.getByRole('region', { name: 'Online booking' }))
    fireEvent.change(panel.getByLabelText('Online booking date'), { target: { value: date } })
    return panel
  }

  it('keeps the doctor on the schedule when the online booking date is cleared', async () => {
    const user = userEvent.setup()
    const doctor = await openOnlineBookingFor(user, tomorrow)
    fireEvent.change(doctor.getByLabelText('Online booking date'), { target: { value: '' } })
    expect(screen.getByRole('region', { name: 'Online booking' })).toHaveTextContent('Patients can see the booked times on')
    expect(doctor.getByLabelText('Online booking date')).toHaveValue(tomorrow)
  })

  it('a doctor opens online booking for a day, and a patient books an open time that day', async () => {
    localStorage.setItem(storageKeys.patients, JSON.stringify([sofia(), secondPatient()]))
    const user = userEvent.setup()
    const doctor = await openOnlineBookingFor(user, tomorrow)
    await user.click(doctor.getByRole('button', { name: 'Accept online bookings for this day' }))
    expect(JSON.parse(localStorage.getItem(storageKeys.onlineDates)!)).toEqual([tomorrow])
    cleanup()

    render(<App />)
    await signIntoDemo(user, 'Patient')
    fireEvent.change(bookingRegion().getByLabelText('Date', { exact: true }), { target: { value: tomorrow } })
    await user.click(bookingRegion().getByRole('button', { name: /11:00 AM · Open/ }))
    await user.type(bookingRegion().getByLabelText(/Reason for visit/), 'Follow-up on blood pressure')
    await user.click(bookingRegion().getByRole('button', { name: 'Confirm booking' }))
    expect(bookingRegion().getByRole('status')).toHaveTextContent(/Booked for .*11:00 AM.*Reference/)
    expect(JSON.parse(localStorage.getItem(storageKeys.appointments)!)).toEqual([expect.objectContaining({
      patientId: 'p-1001', date: tomorrow, time: '11:00', duration: 30, status: 'scheduled', source: 'online', reason: 'Online booking · Follow-up on blood pressure',
    })])
  })

  it('shows a day’s booked times without any other patient’s name, and says when online booking is not open', async () => {
    localStorage.setItem(storageKeys.patients, JSON.stringify([sofia(), secondPatient()]))
    localStorage.setItem(storageKeys.appointments, JSON.stringify([appointment({ id: 'a-bea', patientId: 'patient-b', date: tomorrow, time: '10:00', duration: 30 })]))
    const user = userEvent.setup()
    render(<App />)
    await signIntoDemo(user, 'Patient')
    fireEvent.change(bookingRegion().getByLabelText('Date', { exact: true }), { target: { value: tomorrow } })
    expect(bookingRegion().getByRole('button', { name: /10:00 AM · Booked/ })).toBeDisabled()
    expect(bookingRegion().getByRole('button', { name: /11:00 AM · Not open online/ })).toBeDisabled()
    expect(bookingRegion().getByText(/not accepting online bookings on this day/)).toBeInTheDocument()
    expect(screen.queryByText(/Bea Cruz/)).not.toBeInTheDocument()
  })

  it('slots that have already started today cannot be booked, and the rest of an open day can', async () => {
    localStorage.setItem(storageKeys.patients, JSON.stringify([sofia(), secondPatient()]))
    localStorage.setItem(storageKeys.onlineDates, JSON.stringify([today]))
    const user = userEvent.setup()
    render(<App />)
    await signIntoDemo(user, 'Patient')
    expect(bookingRegion().getByRole('button', { name: /9:00 AM · Passed/ })).toBeDisabled()
    expect(bookingRegion().getByRole('button', { name: /9:30 AM · Open/ })).toBeEnabled()
  })

  it('a patient who already has an appointment that day is told so, and no second booking is saved', async () => {
    localStorage.setItem(storageKeys.patients, JSON.stringify([sofia(), secondPatient()]))
    localStorage.setItem(storageKeys.onlineDates, JSON.stringify([tomorrow]))
    localStorage.setItem(storageKeys.appointments, JSON.stringify([appointment({ id: 'a-sofia', patientId: 'p-1001', date: tomorrow, time: '09:00', duration: 30 })]))
    const user = userEvent.setup()
    render(<App />)
    await signIntoDemo(user, 'Patient')
    fireEvent.change(bookingRegion().getByLabelText('Date', { exact: true }), { target: { value: tomorrow } })
    await user.click(bookingRegion().getByRole('button', { name: /11:00 AM · Open/ }))
    await user.click(bookingRegion().getByRole('button', { name: 'Confirm booking' }))
    expect(bookingRegion().getByRole('alert')).toHaveTextContent('You already have an appointment on this day.')
    expect(JSON.parse(localStorage.getItem(storageKeys.appointments)!)).toHaveLength(1)
  })

  it('a doctor can stop accepting online bookings for a day, and patients then see it closed', async () => {
    localStorage.setItem(storageKeys.patients, JSON.stringify([sofia(), secondPatient()]))
    localStorage.setItem(storageKeys.onlineDates, JSON.stringify([tomorrow]))
    const user = userEvent.setup()
    const doctor = await openOnlineBookingFor(user, tomorrow)
    await user.click(doctor.getByRole('button', { name: 'Stop online bookings for this day' }))
    expect(JSON.parse(localStorage.getItem(storageKeys.onlineDates)!)).toEqual([])
  })
})

describe('SRS QUE-05: staff add a patient to the queue without the QR', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 9, 9, 0, 0))
  })

  async function fillManual(user: ReturnType<typeof userEvent.setup>, fields: { name: string; birthDate?: string; sex?: string; phone?: string; reason?: string; urgent?: boolean }) {
    const dialog = within(screen.getByRole('dialog', { name: /Add patient to today’s queue/ }))
    if (fields.urgent) await user.click(dialog.getByRole('checkbox', { name: /Urgent or emergency/ }))
    await user.type(dialog.getByRole('textbox', { name: /Patient name/ }), fields.name)
    fireEvent.change(dialog.getByLabelText('Date of birth'), { target: { value: fields.birthDate ?? '1990-05-10' } })
    await user.selectOptions(dialog.getByRole('combobox', { name: /Sex/ }), fields.sex ?? 'Male')
    if (fields.phone) await user.type(dialog.getByRole('textbox', { name: /Phone/ }), fields.phone)
    if (fields.reason) await user.type(dialog.getByRole('textbox', { name: /Why is this urgent|Reason for visit/ }), fields.reason)
    return dialog
  }

  async function doctorAddsManually(user: ReturnType<typeof userEvent.setup>) {
    await openQueue(user)
    await user.click(screen.getByRole('button', { name: 'Add patient manually' }))
  }

  it('lets the doctor add an urgent patient while check-in is paused, and calls that patient before an earlier regular ticket', async () => {
    const user = userEvent.setup()
    renderDemo()
    await openQueue(user)
    await user.click(screen.getByRole('button', { name: 'Generate today’s QR' }))
    await joinPreview(user, 'Early Adult', '09170000001')
    await user.click(screen.getByRole('button', { name: 'Back to clinic' }))
    await user.click(screen.getByRole('button', { name: 'Pause check-in' }))
    expect(screen.getByText('Check-in paused')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add patient manually' }))
    const dialog = await fillManual(user, { name: 'Emergency Case', reason: 'Chest pain', urgent: true })
    await user.click(dialog.getByRole('button', { name: 'Add as urgent' }))
    expect(screen.getByText(/U-001 added to today’s queue as urgent/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /Add patient to today’s queue/ })).not.toBeInTheDocument()

    const saved = savedQueue()
    expect(saved.isOpen).toBe(false)
    expect(saved.entries).toHaveLength(2)
    expect(saved.entries[1]).toMatchObject({
      number: 'U-001', lane: 'urgent', name: 'Emergency Case', phone: '', status: 'waiting', stage: 'ready',
      reportedReason: 'Chest pain', addedBy: 'Doctor', reportedAllergyStatus: 'unknown', birthDate: '1990-05-10',
    })
    expect(savedPatients().find((item) => item.name === 'Emergency Case')).toMatchObject({ allergyStatus: 'unknown', allergy: 'Not recorded', phone: '' })
    const rows = screen.getAllByText(/^(R|U)-00\d$/).map((cell) => cell.textContent)
    expect(rows).toEqual(['U-001', 'R-001'])
    expect(screen.getByText('Urgent', { selector: '.queue-lane-urgent' })).toBeInTheDocument()
    expect(screen.getByText(/Added by doctor · Reported: Chest pain/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Call next/ }))
    expect(savedQueue().entries.find((item) => item.status === 'called')?.number).toBe('U-001')
  })

  it('works when the closing time has passed and when the doctor has ended intake', async () => {
    const user = userEvent.setup()
    renderDemo()
    await openQueue(user)
    await user.selectOptions(screen.getByRole('combobox', { name: /Check-in closes at/ }), '08:30')
    await user.click(screen.getByRole('button', { name: 'Generate today’s QR' }))
    expect(screen.getByText('Closed at 08:30')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add patient manually' }))
    await user.click((await fillManual(user, { name: 'After Hours', reason: 'Fever' })).getByRole('button', { name: 'Add to queue' }))
    expect(savedQueue().entries.map((item) => item.number)).toEqual(['R-001'])
    expect(savedQueue().entries[0].lane).toBe('regular')

    await user.click(screen.getByRole('button', { name: 'End today’s intake' }))
    await user.click(screen.getByRole('button', { name: 'End intake for today' }))
    await user.click(screen.getByRole('button', { name: 'Add patient manually' }))
    await user.click((await fillManual(user, { name: 'Senior After Close', birthDate: '1950-01-01' })).getByRole('button', { name: 'Add to queue' }))
    expect(savedQueue().ended).toBe(true)
    expect(savedQueue().entries.map((item) => [item.number, item.lane])).toEqual([['R-001', 'regular'], ['P-001', 'priority']])
  })

  it('creates a paused session when there is none, so an emergency before the QR is generated is not lost', async () => {
    const user = userEvent.setup()
    renderDemo()
    await doctorAddsManually(user)
    await user.click((await fillManual(user, { name: 'First Of The Day', reason: 'Bleeding', urgent: true })).getByRole('button', { name: 'Add as urgent' }))
    expect(screen.getByText(/Check-in by QR stays paused until the doctor reopens it/)).toBeInTheDocument()
    const saved = savedQueue()
    expect(saved).toMatchObject({ date: dateKey(new Date()), isOpen: false })
    expect(saved.token.length).toBeGreaterThan(0)
    expect(saved.entries).toHaveLength(1)
    expect(screen.getByText('Check-in paused')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reopen check-in' }))
    expect(screen.getByText('Accepting check-ins')).toBeInTheDocument()
  })

  it('refuses invalid input without creating a ticket or a chart, and keeps what was typed', async () => {
    const user = userEvent.setup()
    renderDemo()
    await doctorAddsManually(user)
    const dialog = await fillManual(user, { name: 'Urgent No Reason', urgent: true })
    await user.click(dialog.getByRole('button', { name: 'Add as urgent' }))
    expect(dialog.getByRole('alert')).toHaveTextContent('Enter why this patient is urgent.')
    expect(dialog.getByRole('textbox', { name: /Patient name/ })).toHaveValue('Urgent No Reason')
    expect(JSON.parse(localStorage.getItem(storageKeys.queue) ?? 'null')).toBeNull()
    expect(savedPatients()).toHaveLength(2)
    await user.type(dialog.getByRole('textbox', { name: /Why is this urgent/ }), 'Seizure')
    expect(dialog.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: 'Add as urgent' }))
    expect(savedQueue().entries).toHaveLength(1)
  })

  it('links an existing chart by name, phone and date of birth, and returns an error for a patient already in line', async () => {
    const user = userEvent.setup()
    renderDemo()
    await doctorAddsManually(user)
    await user.click((await fillManual(user, { name: 'Alice Santos', sex: 'Female', phone: '0917 123 4567', reason: 'Fall' })).getByRole('button', { name: 'Add to queue' }))
    expect(savedPatients()).toHaveLength(2)
    expect(savedQueue().entries[0].patientId).toBe('patient-a')

    await user.click(screen.getByRole('button', { name: 'Add patient manually' }))
    const dialog = await fillManual(user, { name: 'alice santos', sex: 'Female', phone: '09171234567' })
    await user.click(dialog.getByRole('button', { name: 'Add to queue' }))
    expect(dialog.getByRole('alert')).toHaveTextContent('already in today’s queue as R-001')
    expect(savedQueue().entries).toHaveLength(1)
  })

  it('never links a patient with no phone to an existing chart, so two people with the same name stay separate', async () => {
    const user = userEvent.setup()
    renderDemo()
    await doctorAddsManually(user)
    await user.click((await fillManual(user, { name: 'Alice Santos', sex: 'Female', reason: 'Fall' })).getByRole('button', { name: 'Add to queue' }))
    const patients = savedPatients()
    expect(patients).toHaveLength(3)
    expect(savedQueue().entries[0].patientId).not.toBe('patient-a')
    expect(patients.filter((item) => item.name === 'Alice Santos')).toHaveLength(2)
  })

  it('lets the attendant add a patient and shows the ticket in the reception list, recorded as added by the attendant', async () => {
    const user = userEvent.setup()
    render(<App />)
    await signIntoDemo(user, 'Attendant')
    await user.click(screen.getByRole('button', { name: 'Add to queue' }))
    await user.click((await fillManual(user, { name: 'Reception Emergency', reason: 'Difficulty breathing', urgent: true })).getByRole('button', { name: 'Add as urgent' }))
    const list = within(screen.getByRole('region', { name: /Today’s reception queue/ }))
    expect(list.getByText('U-001')).toBeInTheDocument()
    expect(list.getByText('Reception Emergency')).toBeInTheDocument()
    expect(savedQueue().entries[0]).toMatchObject({ addedBy: 'Attendant', lane: 'urgent', reportedReason: 'Difficulty breathing' })
    // The attendant can still record optional triage for the manually added patient.
    expect(list.getByRole('button', { name: 'Record triage' })).toBeInTheDocument()
  })

  it('lets the doctor start a consultation for the manually added patient and confirm allergies there', async () => {
    const user = userEvent.setup()
    renderDemo()
    await doctorAddsManually(user)
    await user.click((await fillManual(user, { name: 'Emergency Case', reason: 'Chest pain', urgent: true })).getByRole('button', { name: 'Add as urgent' }))
    await user.click(screen.getByRole('button', { name: 'Start consultation' }))
    const consult = within(screen.getByRole('dialog', { name: 'Complete visit' }))
    expect(consult.getByText('Chest pain')).toBeInTheDocument()
    expect(consult.getByRole('group', { name: 'Allergy confirmation' })).toBeInTheDocument()
    expect(savedQueue().entries[0].stage).toBe('consulting')
  })

  it('does not offer manual entry to patients', async () => {
    const user = userEvent.setup()
    render(<App />)
    await signIntoDemo(user, 'Patient')
    expect(screen.queryByRole('button', { name: /Add to queue|Add patient manually/ })).not.toBeInTheDocument()
  })
})
