import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { dateKey } from './clinic'
import { MAX_DOCUMENT_BYTES } from './workflow'
import { patient, queue, storageKeys } from './test/fixtures'
import { createUser, openChart, prescriptionTab, renderDemo, savedPatients, savedQueue, secondPatient, seedBaseStorage, signIntoDemo, startVisit } from './test/helpers'

beforeEach(() => {
  seedBaseStorage()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('patient registration', () => {
  it.each([
    ['unknown', 'Not recorded'],
    ['none', 'No known allergies'],
    ['known', 'Latex'],
  ])('registers a patient with explicit %s allergy status and persists their chart', async (status, allergy) => {
    const user = createUser()
    renderDemo()
    await user.click(screen.getByRole('button', { name: 'New walk-in' }))
    const dialog = within(screen.getByRole('dialog', { name: 'New walk-in patient' }))
    await user.type(dialog.getByRole('textbox', { name: /Patient name/ }), '  Carla Diaz  ')
    fireEvent.change(dialog.getByLabelText('Date of birth'), { target: { value: '1995-04-03' } })
    await user.selectOptions(dialog.getByRole('combobox', { name: /Sex/ }), 'Female')
    await user.type(dialog.getByRole('textbox', { name: /Email address/ }), 'carla@example.test')
    await user.selectOptions(dialog.getByRole('combobox', { name: /Allergy status/ }), status)
    if (status === 'known') await user.type(dialog.getByRole('textbox', { name: /^Known allergies/ }), '  Latex  ')
    await user.click(dialog.getByRole('button', { name: 'Register & open chart' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Carla Diaz' })).toBeInTheDocument()
    expect(savedPatients()[0]).toMatchObject({ name: 'Carla Diaz', birthDate: '1995-04-03', sex: 'Female', email: 'carla@example.test', allergyStatus: status, allergy })
    expect(savedPatients()[0].records).toEqual([])
  })

  it('rejects invalid walk-in submissions and cancel without creating a chart', async () => {
    const user = createUser()
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

    await user.selectOptions(dialog.getByRole('combobox', { name: /Allergy status/ }), 'none')
    await user.type(dialog.getByRole('textbox', { name: /Email address/ }), 'carla-at-example')
    fireEvent.submit(dialog.getByRole('button', { name: 'Register & open chart' }).closest('form')!)
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email address or leave it blank.')
    expect(savedPatients()).toHaveLength(2)

    fireEvent.change(dialog.getByLabelText('Date of birth'), { target: { value: '2999-01-01' } })
    fireEvent.submit(dialog.getByRole('button', { name: 'Register & open chart' }).closest('form')!)
    expect(screen.getByRole('alert')).toHaveTextContent('Date of birth cannot be in the future')
    expect(savedPatients()).toHaveLength(2)

    await user.click(dialog.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(savedPatients()).toHaveLength(2)
  })

  it('registers a patient at reception without opening a doctor chart or changing existing histories', async () => {
    const originalPatients = [patient({
      notes: 'Original synthetic interview note',
      records: [{ id: 'old-visit', date: '2026-01-10', signs: 'Original signs', symptoms: 'Original symptoms', diagnosis: 'Original assessment' }],
      prescriptions: [{ id: 'old-rx', date: '2026-01-10', medication: 'Synthetic original medication', strength: 'Original strength', instructions: 'Original directions', duration: 'Original duration', notes: 'Original prescription note' }],
    }), secondPatient()]
    localStorage.setItem(storageKeys.patients, JSON.stringify(originalPatients))

    const user = createUser()
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
    const demographics = within(screen.getByRole('region', { name: 'Today’s patient details' }))
    expect(demographics.getByText('Carla Diaz')).toBeVisible()
    expect(screen.queryByRole('heading', { level: 1, name: 'Carla Diaz' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Clinical notes|Prescriptions|View history/ })).not.toBeInTheDocument()
    const patients = savedPatients()
    expect(patients).toHaveLength(3)
    expect(patients.slice(1)).toEqual(originalPatients)
  })
})

describe('patient directory', () => {
  it('filters by search and allergy status, sorts, paginates, resets filters, and opens charts via keyboard', async () => {
    const directoryPatients = [
      patient({ id: 'p-1', name: 'Alice Santos', patientNumber: 'PT-10001', joined: '2026-01-01', allergyStatus: 'known', allergy: 'Penicillin' }),
      patient({ id: 'p-2', name: 'Bea Cruz', patientNumber: 'PT-10002', joined: '2026-02-01', allergyStatus: 'none', allergy: 'No known allergies' }),
      patient({ id: 'p-3', name: 'Carla Diaz', patientNumber: 'PT-10003', joined: '2026-03-01', allergyStatus: 'unknown', allergy: 'Not recorded' }),
      patient({ id: 'p-4', name: 'Danilo Reyes', patientNumber: 'PT-10004', joined: '2026-04-01', allergyStatus: 'none', allergy: 'No known allergies' }),
      patient({ id: 'p-5', name: 'Elena Bautista', patientNumber: 'PT-10005', joined: '2026-05-01', allergyStatus: 'known', allergy: 'Sulfa' }),
    ]
    localStorage.setItem(storageKeys.patients, JSON.stringify(directoryPatients))
    const user = createUser()
    renderDemo()

    await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', { name: /^Patients/ }))
    expect(screen.getByRole('heading', { level: 1, name: 'Patients' })).toBeInTheDocument()
    expect(document.querySelector('.table-footer')).toHaveTextContent('Showing 1–4 of 5 patients')

    await user.click(screen.getByRole('button', { name: 'Next patient page' }))
    expect(document.querySelector('.table-footer')).toHaveTextContent('Showing 5–5 of 5 patients')
    expect(screen.getByRole('row', { name: /Elena Bautista/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Previous patient page' }))
    expect(document.querySelector('.table-footer')).toHaveTextContent('Showing 1–4 of 5 patients')

    await user.click(screen.getByRole('button', { name: 'Recently added' }))
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Elena Bautista')

    await user.click(screen.getByRole('button', { name: /^Filters/ }))
    const popover = within(screen.getByRole('dialog', { name: 'Patient filters' }))
    await user.selectOptions(popover.getByLabelText('Allergy status'), 'unrecorded')
    expect(screen.getByRole('row', { name: /Carla Diaz/ })).toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /Alice Santos/ })).not.toBeInTheDocument()

    await popover.getByRole('button', { name: 'Clear' }).click()
    await user.type(screen.getByPlaceholderText('Search by name, patient ID, or phone'), 'nobody-matches')
    expect(screen.getByText('No patients match your search and filters.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'More patient list options' }))
    await user.click(screen.getByRole('menuitem', { name: 'Reset search and filters' }))
    expect(screen.getByPlaceholderText('Search by name, patient ID, or phone')).toHaveValue('')
    expect(screen.getByRole('row', { name: /Alice Santos/ })).toBeInTheDocument()

    const aliceRow = screen.getByRole('row', { name: /Alice Santos/ })
    aliceRow.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('heading', { level: 1, name: 'Alice Santos' })).toBeInTheDocument()
  })
})

describe('clinical documentation and isolation', () => {
  it('snapshots interview-only notes into visit history, preserves them after reload, and rejects empty visits', async () => {
    const user = createUser()
    const view = renderDemo()
    await openChart(user)
    await startVisit(user)
    await user.click(screen.getByRole('button', { name: 'Save visit to chart' }))
    expect(screen.getByText('Add a note, signs, symptoms, or diagnosis before saving.')).toBeInTheDocument()
    expect(savedPatients()[0].records).toHaveLength(0)

    await user.type(screen.getByLabelText(/Interview notes/), 'Patient reports symptoms since yesterday.')
    await user.click(screen.getByRole('button', { name: 'Save visit to chart' }))
    expect(savedPatients()[0]).toMatchObject({ notes: '', lastVisit: dateKey(new Date()), records: [{ notes: 'Patient reports symptoms since yesterday.', signs: '', symptoms: '', diagnosis: '' }] })
    view.unmount()

    renderDemo()
    await openChart(user)
    await user.click(screen.getByRole('button', { name: /^Medical history/ }))
    expect(screen.getByText('Patient reports symptoms since yesterday.')).toBeInTheDocument()
  })

  it('assigns distinct record IDs when multiple records are saved in the same millisecond', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-09T10:00:00'))
    const user = createUser()
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
  })

  it('isolates unsaved visit/prescription drafts across charts and labels draft printouts', async () => {
    const user = createUser()
    renderDemo()
    await openChart(user)
    await startVisit(user)
    await user.type(screen.getByPlaceholderText('Add a working diagnosis'), 'Alice only')
    await user.type(screen.getByLabelText(/Interview notes/), 'Alice draft')
    await prescriptionTab(user)
    await user.type(screen.getByRole('textbox', { name: /Medication name/ }), '  Demo Rx  ')
    await user.type(screen.getByRole('textbox', { name: 'Directions for use' }), 'Once daily')
    await user.click(screen.getByRole('button', { name: 'Add to chart' }))

    const preview = document.getElementById('print-prescription')!
    expect(preview).toHaveTextContent('DEMO DRAFT — not a finalized prescription')
    expect(preview).toHaveTextContent('Rx · DRAFT')
    expect(preview).toHaveTextContent('Dr. Maya Reyes (sample clinician)')
    expect(preview).toHaveTextContent('Sample identity · not authenticated')
    expect(preview).toHaveTextContent('Alice Santos')

    await user.type(screen.getByRole('textbox', { name: /Medication name/ }), 'Unsaved Rx')
    await openChart(user, 'Bea Cruz')
    await startVisit(user)
    expect(screen.getByPlaceholderText('Add a working diagnosis')).toHaveValue('')
    expect(screen.getByLabelText(/Interview notes/)).toHaveValue('')
    await prescriptionTab(user)
    expect(screen.getByRole('textbox', { name: /Medication name/ })).toHaveValue('')
    expect(screen.queryByText('Demo Rx')).not.toBeInTheDocument()
    expect(savedPatients()[1].prescriptions).toEqual([])
  })
})

describe('document upload and review', () => {
  it('reviews editable extracted text before saving it to only the active patient chart', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ filename: 'lab-result.pdf', file_type: 'pdf', page_count: 2, ocr_pages_used: [2], text: 'Original extracted result', processing_time_ms: 120 }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const user = createUser()
    renderDemo()
    await openChart(user)
    await user.upload(screen.getByLabelText('Choose a patient document'), new File(['synthetic pdf'], 'lab-result.pdf', { type: 'application/pdf' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/documents/parse', expect.objectContaining({ method: 'POST' }))

    const review = screen.getByRole('textbox', { name: /Extracted text/ })
    await user.clear(review)
    await user.type(review, '   ')
    await user.click(screen.getByRole('button', { name: 'Save to patient chart' }))
    expect(within(screen.getByRole('dialog', { name: 'Review extracted text' })).getByRole('alert')).toHaveTextContent('Review the extracted text before saving. The text cannot be empty.')
    expect(savedPatients()[0].documents).toEqual([])

    await user.clear(review)
    await user.type(review, 'Doctor corrected result')
    await user.click(screen.getByRole('button', { name: 'Save to patient chart' }))
    expect(savedPatients()[0].documents).toMatchObject([{ filename: 'lab-result.pdf', pageCount: 2, ocrPagesUsed: [2], text: 'Doctor corrected result' }])
    expect(savedPatients()[1].documents).toEqual([])
    expect(screen.getByText('Doctor corrected result')).toBeInTheDocument()
  })

  it('rejects oversized uploads client-side and handles JSON and non-JSON parser error responses cleanly', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Unsupported file type' }), { status: 415, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }))
    vi.stubGlobal('fetch', fetchMock)
    const user = createUser()
    renderDemo()
    await openChart(user)
    const input = screen.getByLabelText('Choose a patient document')

    const oversized = new File(['x'], 'huge.pdf', { type: 'application/pdf' })
    Object.defineProperty(oversized, 'size', { value: MAX_DOCUMENT_BYTES + 1 })
    fireEvent.change(input, { target: { files: [oversized] } })
    expect(screen.getByRole('alert')).toHaveTextContent('File exceeds 25MB limit.')
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Unsupported file type')
    expect(screen.queryByRole('dialog', { name: 'Review extracted text' })).not.toBeInTheDocument()

    fireEvent.change(input, { target: { files: [new File(['x'], 'scan.png', { type: 'image/png' })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to parse document.')
    expect(savedPatients()[0].documents).toEqual([])
  })
})

describe('browser storage resilience and global search', () => {
  it.each(['{}', 'null', '{'])('recovers from invalid stored patient and appointment data %s', (raw) => {
    localStorage.setItem(storageKeys.patients, raw)
    localStorage.setItem(storageKeys.appointments, raw)
    localStorage.setItem(storageKeys.queue, raw)
    renderDemo()
    expect(screen.getByRole('heading', { level: 1, name: /Good morning/ })).toBeInTheDocument()
    expect(savedPatients()).toHaveLength(5)
  })

  it('warns when browser storage is full in workspace and during public check-in', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError') })
    const view = renderDemo()
    expect(screen.getByRole('alert')).toHaveTextContent('Browser storage is unavailable. Changes may be lost when you reload.')
    view.unmount()
    vi.restoreAllMocks()

    localStorage.setItem(storageKeys.queue, JSON.stringify(queue()))
    window.history.replaceState({}, '', '/?queue=test-daily-token')
    const user = createUser()
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

  it('trims outer spaces in global patient searches and focuses search on Ctrl/Cmd+K', async () => {
    const user = createUser()
    renderDemo()
    const searchField = screen.getByRole('textbox', { name: 'Search patients' })
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(searchField).toHaveFocus()
    await user.type(searchField, '  Bea Cruz  ')
    expect(within(searchField.parentElement!).getByRole('button', { name: /Bea Cruz/ })).toBeInTheDocument()
  })
})
