import { describe, expect, it } from 'vitest'
import { dateKey, type Appointment, type QueueEntry } from './clinic'
import {
  entryLane, laneForAge, laneLabel, manualQueueError, manualQueueLane, nextTicketNumber, nowServing, peopleAhead, PEDIATRIC_MAX_AGE, priorityReason, queueDisplayOrder, SENIOR_MIN_AGE, ticketStanding, waitingOrder,
  allergyAfterReview, allergyConfirmationError, allergyNames, allergyReviewError, canRecordTriage, isAwaitingDoctor, mergeAllergies, reconcileAllergy, visitAllergyOutcome,
  closingTimeOptions, intakeStatus, minutesOfDay, REASON_MAX_LENGTH, reportedText, reportedTextError, SYMPTOMS_MAX_LENGTH,
  addDays, dayAvailability, formatTime, ONLINE_BOOKING_DAYS, onlineBookingError, toggleOnlineDate,
  allergyDescription, appointmentStartTimes, bookingError, checkInError, confirmedAllergyError, documentSizeError,
  encounterPrescription, encounterRecord, filterPatients, findActiveTicket, findMatchingChart, hasEncounterContent,
  MAX_DOCUMENT_BYTES, parsedDocument, parserErrorMessage, patientNumberFor, phoneDigits, queueRowAction, queueSnapshot,
  queueStatusLabel, registrationError, reviewedTextError, searchPatients, ticketNumber, visibleDays,
  type ManualQueueForm, type RegistrationForm, type VisitValues,
} from './workflow'
import { appointment, patient } from './test/fixtures'

const TODAY = new Date(2026, 10, 9, 10, 0, 0)

const validRegistration: RegistrationForm = {
  name: 'Carla Diaz', birthDate: '1995-04-03', sex: 'Female', email: '', allergyStatus: 'none', allergyDetails: '',
}

function entry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    id: 'q-1', number: '001', name: 'Alice Santos', phone: '09171234567', joinedAt: '2026-11-09T01:00:00.000Z',
    status: 'waiting', patientId: 'patient-a', birthDate: '1990-05-10', stage: 'triage', ...overrides,
  }
}

const visit: VisitValues = {
  signs: '', symptoms: '', diagnosis: '', notes: '', medication: '', strength: '', instructions: '', duration: '',
}

describe('walk-in registration rules', () => {
  it('accepts a complete form without an email address', () => {
    expect(registrationError(validRegistration, TODAY)).toBeNull()
  })

  it.each([
    ['a blank name', { name: '   ' }, 'Enter the patient’s name to continue.'],
    ['a missing date of birth', { birthDate: '' }, 'Enter the patient’s date of birth.'],
    ['an impossible calendar date', { birthDate: '2026-02-30' }, 'Enter a valid date of birth.'],
    ['a future date of birth', { birthDate: '2026-11-10' }, 'Date of birth cannot be in the future.'],
    ['a missing sex', { sex: '' }, 'Select the patient’s sex or choose not to disclose.'],
    ['a missing allergy status', { allergyStatus: '' as const }, 'Record an allergy status before continuing.'],
    ['known allergies without details', { allergyStatus: 'known' as const, allergyDetails: '  ' }, 'Enter the known allergy or select another allergy status.'],
    ['a malformed email address', { email: 'carla-at-example' }, 'Enter a valid email address or leave it blank.'],
    ['an email with spaces', { email: 'carla diaz@example.test' }, 'Enter a valid email address or leave it blank.'],
  ])('rejects %s', (_label, change, message) => {
    expect(registrationError({ ...validRegistration, ...change }, TODAY)).toBe(message)
  })

  it('accepts a date of birth equal to today and rejects one day later', () => {
    expect(registrationError({ ...validRegistration, birthDate: '2026-11-09' }, TODAY)).toBeNull()
    expect(registrationError({ ...validRegistration, birthDate: '2026-11-10' }, TODAY)).toBe('Date of birth cannot be in the future.')
  })

  it('accepts a well-formed email, trimming surrounding spaces, and stores nothing when it is blank', () => {
    expect(registrationError({ ...validRegistration, email: '  carla@example.test  ' }, TODAY)).toBeNull()
    expect(registrationError({ ...validRegistration, email: '   ' }, TODAY)).toBeNull()
  })

  it('reports the first failing rule when several are wrong', () => {
    expect(registrationError({ ...validRegistration, name: '', birthDate: '2999-01-01', sex: '' }, TODAY)).toBe('Enter the patient’s name to continue.')
    expect(registrationError({ ...validRegistration, birthDate: '2999-01-01', sex: '' }, TODAY)).toBe('Date of birth cannot be in the future.')
  })

  it.each([
    ['none', '', 'No known allergies'],
    ['unknown', '', 'Not recorded'],
    ['known', '  Penicillin  ', 'Penicillin'],
  ] as const)('stores allergy status %s as "%s" text', (status, details, stored) => {
    expect(allergyDescription(status, details)).toBe(stored)
  })

  it('never renders an unknown allergy status as no known allergies', () => {
    expect(allergyDescription('unknown', '')).not.toBe('No known allergies')
  })

  it('requires details only for a confirmed known allergy', () => {
    expect(confirmedAllergyError('known', '   ')).toBe('Enter the confirmed allergy details.')
    expect(confirmedAllergyError('known', 'Latex')).toBeNull()
    expect(confirmedAllergyError('none', '')).toBeNull()
    expect(confirmedAllergyError('unknown', '')).toBeNull()
    expect(confirmedAllergyError('', '')).toBeNull()
  })
})

describe('public check-in validation', () => {
  const details = { name: 'Alice Santos', phone: '09171234567', birthDate: '1990-05-10', sex: 'Female', allergyStatus: 'none' as const, allergy: '' }

  it('accepts a complete check-in, including a single digit phone', () => {
    expect(checkInError(details, TODAY)).toBeNull()
    expect(checkInError({ ...details, phone: '1' }, TODAY)).toBeNull()
  })

  it.each([
    ['a blank name', { name: '  ' }],
    ['a blank phone', { phone: '  ' }],
    ['a phone without any digit', { phone: 'call me' }],
    ['a missing date of birth', { birthDate: '' }],
    ['an impossible date of birth', { birthDate: '1990-13-01' }],
    ['a future date of birth', { birthDate: '2999-01-01' }],
    ['a missing sex', { sex: '' }],
    ['a known allergy without details', { allergyStatus: 'known' as const, allergy: '  ' }],
  ])('rejects %s', (_label, change) => {
    expect(checkInError({ ...details, ...change }, TODAY)).toBe('Enter your name, phone, valid date of birth, sex, and allergy details when known.')
  })

  it('accepts a known allergy once details are entered and treats unknown status as not requiring details', () => {
    expect(checkInError({ ...details, allergyStatus: 'known', allergy: 'Penicillin' }, TODAY)).toBeNull()
    expect(checkInError({ ...details, allergyStatus: 'unknown', allergy: '' }, TODAY)).toBeNull()
  })
})

describe('ticket and chart identity matching', () => {
  const identity = { name: 'Alice Santos', phone: '0917-123-4567', birthDate: '1990-05-10' }

  it('returns the open ticket for the same person with different name casing and phone formatting', () => {
    const open = entry()
    expect(findActiveTicket([open], { ...identity, name: '  alice SANTOS  ', phone: '09171234567' })).toBe(open)
  })

  it('does not reuse a completed ticket, a different date of birth, a different phone, or a legacy ticket without a date of birth', () => {
    expect(findActiveTicket([entry({ status: 'completed' })], identity)).toBeUndefined()
    expect(findActiveTicket([entry({ birthDate: '1991-05-10' })], identity)).toBeUndefined()
    expect(findActiveTicket([entry({ phone: '09170000000' })], identity)).toBeUndefined()
    expect(findActiveTicket([entry({ birthDate: undefined })], identity)).toBeUndefined()
  })

  it('links an arrival to an existing chart only when name, phone digits and date of birth all match', () => {
    const chart = patient({ name: 'Alice Santos', phone: '0917-123-4567', birthDate: '1990-05-10' })
    expect(findMatchingChart([chart], identity)).toBe(chart)
    expect(findMatchingChart([chart], { ...identity, name: 'alice santos' })).toBe(chart)
    expect(findMatchingChart([chart], { ...identity, birthDate: '1991-05-10' })).toBeUndefined()
    expect(findMatchingChart([chart], { ...identity, name: 'Bea Cruz' })).toBeUndefined()
  })

  it('treats a shared phone number as insufficient to identify the same patient', () => {
    const chart = patient({ name: 'Alice Santos', phone: '09171234567', birthDate: '1990-05-10' })
    expect(findMatchingChart([chart], { name: 'Maria Santos', phone: '09171234567', birthDate: '1990-05-10' })).toBeUndefined()
    expect(findMatchingChart([chart], { name: 'Alice Santos', phone: '09171234567', birthDate: '1985-01-01' })).toBeUndefined()
  })

  it('normalizes phone numbers to digits only', () => {
    expect(phoneDigits('+63 (917) 123-4567')).toBe('639171234567')
    expect(phoneDigits('no digits')).toBe('')
  })

  it('issues zero-padded, increasing ticket numbers and chart numbers', () => {
    expect(ticketNumber(0, 'regular')).toBe('R-001')
    expect(ticketNumber(8, 'regular')).toBe('R-009')
    expect(ticketNumber(999, 'priority')).toBe('P-1000')
    expect(ticketNumber(0, 'urgent')).toBe('U-001')
    expect(patientNumberFor(0)).toBe('PT-10500')
    expect(patientNumberFor(5)).toBe('PT-10505')
    expect(ticketNumber(1, 'regular')).not.toBe(ticketNumber(0, 'regular'))
  })
})

describe('daily queue snapshot and row actions', () => {
  it('summarises an empty line without inventing a next patient', () => {
    expect(queueSnapshot([])).toEqual({ waiting: [], called: undefined, consulting: undefined, completedCount: 0, nextWaiting: undefined })
  })

  it('separates waiting, called, consulting and completed entries', () => {
    const triage = entry({ id: 'q-triage', stage: 'triage' })
    const ready = entry({ id: 'q-ready', number: '002', stage: 'ready' })
    const legacy = entry({ id: 'q-legacy', number: '003', stage: undefined })
    const consulting = entry({ id: 'q-consult', number: '004', stage: 'consulting' })
    const done = entry({ id: 'q-done', number: '005', status: 'completed', stage: 'complete' })
    const snapshot = queueSnapshot([triage, ready, legacy, consulting, done])
    expect(snapshot.waiting.map((item) => item.id)).toEqual(['q-triage', 'q-ready', 'q-legacy'])
    expect(snapshot.consulting?.id).toBe('q-consult')
    expect(snapshot.called?.id).toBe('q-consult')
    expect(snapshot.completedCount).toBe(1)
  })

  it('does not require triage before a patient can be next: arrival order decides the default', () => {
    expect(queueSnapshot([entry({ stage: 'ready' })]).nextWaiting?.id).toBe('q-1')
    expect(queueSnapshot([entry({ id: 'q-a', stage: 'triage' }), entry({ id: 'q-b', number: '002', stage: 'ready' })]).nextWaiting?.id).toBe('q-a')
  })

  it('treats a called ticket as occupying the doctor and removes it from the waiting list', () => {
    const called = entry({ id: 'q-called', status: 'called', stage: undefined })
    const snapshot = queueSnapshot([called])
    expect(snapshot.called?.id).toBe('q-called')
    expect(snapshot.waiting).toEqual([])
  })

  it.each([
    ['triage', 'Ready for doctor'], ['ready', 'Ready for doctor'], ['consulting', 'In consultation'], ['complete', 'Visit complete'],
  ] as const)('labels stage %s as "%s"', (stage, label) => {
    expect(queueStatusLabel(entry({ stage }))).toBe(label)
  })

  it.each([
    ['waiting', 'Waiting'], ['called', 'Called'], ['completed', 'Ticket marked seen'],
  ] as const)('labels a legacy %s ticket as "%s"', (status, label) => {
    expect(queueStatusLabel(entry({ status, stage: undefined }))).toBe(label)
  })

  it('offers the doctor a consultation for any waiting patient, triaged or not, unless another consultation is running', () => {
    const idle = { consultationInProgress: false, ticketCalled: false }
    const busy = { consultationInProgress: true, ticketCalled: false }
    expect(queueRowAction(entry({ stage: 'triage' }), idle)).toEqual({ action: 'start-consultation', disabled: false })
    expect(queueRowAction(entry({ stage: 'ready' }), idle)).toEqual({ action: 'start-consultation', disabled: false })
    expect(queueRowAction(entry({ stage: 'ready' }), busy)).toEqual({ action: 'start-consultation', disabled: true })
  })

  it('shows the in-progress consultation and links completed visits to their history', () => {
    const idle = { consultationInProgress: false, ticketCalled: false }
    expect(queueRowAction(entry({ stage: 'consulting' }), idle)).toEqual({ action: 'in-consultation', disabled: false })
    expect(queueRowAction(entry({ stage: 'complete' }), idle)).toEqual({ action: 'view-history', disabled: false })
  })

  it('falls back to ticket actions for legacy tickets and does not call a second ticket while one is called', () => {
    expect(queueRowAction(entry({ status: 'waiting', stage: undefined }), { consultationInProgress: false, ticketCalled: false })).toEqual({ action: 'call-ticket', disabled: false })
    expect(queueRowAction(entry({ status: 'waiting', stage: undefined }), { consultationInProgress: false, ticketCalled: true })).toEqual({ action: 'call-ticket', disabled: true })
    expect(queueRowAction(entry({ status: 'called', stage: undefined }), { consultationInProgress: false, ticketCalled: true })).toEqual({ action: 'mark-seen', disabled: false })
    expect(queueRowAction(entry({ status: 'completed', stage: undefined }), { consultationInProgress: false, ticketCalled: false })).toEqual({ action: 'seen', disabled: false })
    expect(queueRowAction(entry({ stage: 'complete', patientId: undefined, status: 'completed' }), { consultationInProgress: false, ticketCalled: false })).toEqual({ action: 'seen', disabled: false })
  })
})

describe('visit documentation and prescriptions', () => {
  it('saves a visit when any single clinical field or the live interview note has content', () => {
    const empty = { signs: '', symptoms: '', diagnosis: '', liveNotes: '' }
    expect(hasEncounterContent(empty)).toBe(false)
    expect(hasEncounterContent({ ...empty, signs: 'BP 120/80' })).toBe(true)
    expect(hasEncounterContent({ ...empty, symptoms: 'Cough' })).toBe(true)
    expect(hasEncounterContent({ ...empty, diagnosis: 'Viral URTI' })).toBe(true)
    expect(hasEncounterContent({ ...empty, liveNotes: 'Interview draft' })).toBe(true)
    expect(hasEncounterContent({ signs: '   ', symptoms: '\n', diagnosis: '\t', liveNotes: '  ' })).toBe(false)
  })

  it('keeps the live interview draft and visit notes together in one encounter record', () => {
    const record = encounterRecord(
      { ...visit, signs: '  Afebrile  ', diagnosis: ' Tension headache ', notes: ' Rest advised ' },
      { date: '2026-11-09', encounterId: 'enc-1', liveNotes: ' Earlier interview note ', triage: { complaint: 'Headache', notes: '', bloodPressure: '', weight: '', temperature: '' } },
    )
    expect(record).toEqual({
      date: '2026-11-09', signs: 'Afebrile', symptoms: '', diagnosis: 'Tension headache',
      notes: 'Earlier interview note\n\nRest advised', encounterId: 'enc-1',
      triage: { complaint: 'Headache', notes: '', bloodPressure: '', weight: '', temperature: '' },
    })
  })

  it('does not add blank separators when only one note source exists', () => {
    expect(encounterRecord({ ...visit, notes: 'Only visit note' }, { date: '2026-11-09', encounterId: 'enc-1', liveNotes: '   ' }).notes).toBe('Only visit note')
    expect(encounterRecord({ ...visit, notes: '  ' }, { date: '2026-11-09', encounterId: 'enc-1', liveNotes: 'Only draft' }).notes).toBe('Only draft')
    expect(encounterRecord(visit, { date: '2026-11-09', encounterId: 'enc-1', liveNotes: '' }).notes).toBe('')
  })

  it('creates no prescription unless a medication name is entered', () => {
    expect(encounterPrescription({ ...visit, medication: '   ', strength: '10 mg' }, { date: '2026-11-09', encounterId: 'enc-1' })).toBeNull()
  })

  it('links a prescription draft to the same encounter with trimmed directions', () => {
    expect(encounterPrescription({ ...visit, medication: ' Paracetamol ', strength: ' 500 mg ', instructions: ' Every 6 hours ', duration: ' 3 days ' }, { date: '2026-11-09', encounterId: 'enc-1' })).toEqual({
      date: '2026-11-09', medication: 'Paracetamol', strength: '500 mg', instructions: 'Every 6 hours', duration: '3 days', notes: '', encounterId: 'enc-1',
    })
  })

  it('requires reviewed extracted text to contain something other than whitespace', () => {
    expect(reviewedTextError('   ')).toBe('Review the extracted text before saving. The text cannot be empty.')
    expect(reviewedTextError('Reviewed result')).toBeNull()
  })
})

describe('appointment booking rules', () => {
  const candidate = { patientId: 'patient-a', date: '2026-11-09', time: '09:00', duration: 30 }

  it('lists half-hour start times from 08:00 through 17:30', () => {
    const times = appointmentStartTimes()
    expect(times).toHaveLength(20)
    expect(times[0]).toBe('08:00')
    expect(times[times.length - 1]).toBe('17:30')
    expect(times.slice(1).map((time, index) => time > times[index] ? 1 : 0).every(Boolean)).toBe(true)
  })

  it('accepts a valid booking into an empty day', () => {
    expect(bookingError(candidate, [])).toBeNull()
  })

  it.each([
    ['no patient', { patientId: '' }, 'Select a patient before booking.'],
    ['an empty date', { date: '' }, 'Choose a valid appointment date.'],
    ['an impossible date', { date: '2026-02-30' }, 'Choose a valid appointment date.'],
    ['a start time without zero padding', { time: '9:00' }, 'Choose a valid start time.'],
    ['a start time past midnight', { time: '24:00' }, 'Choose a valid start time.'],
    ['an empty start time', { time: '' }, 'Choose a valid start time.'],
    ['zero duration', { duration: 0 }, 'Choose a visit length.'],
    ['a negative duration', { duration: -30 }, 'Choose a visit length.'],
    ['a non-numeric duration', { duration: Number.NaN }, 'Choose a visit length.'],
  ])('rejects a booking with %s', (_label, change, message) => {
    expect(bookingError({ ...candidate, ...change }, [])).toBe(message)
  })

  it('rejects an overlapping slot and allows a slot that starts exactly when another ends', () => {
    const existing = [appointment({ date: '2026-11-09', time: '09:00', duration: 30, status: 'scheduled' })]
    expect(bookingError({ ...candidate, time: '09:15' }, existing)).toBe('That time overlaps an existing appointment. Choose another slot.')
    expect(bookingError({ ...candidate, time: '09:30' }, existing)).toBeNull()
    expect(bookingError({ ...candidate, time: '08:30' }, existing)).toBeNull()
  })

  it('ignores cancelled or completed bookings and bookings on other dates', () => {
    const existing = [
      appointment({ date: '2026-11-09', time: '09:00', status: 'cancelled' }),
      appointment({ date: '2026-11-09', time: '09:00', status: 'completed' }),
      appointment({ date: '2026-11-10', time: '09:00', status: 'scheduled' }),
    ]
    expect(bookingError(candidate, existing)).toBeNull()
  })
})

describe('calendar and directory views', () => {
  it('shows the Monday to Friday work week that contains any anchor day', () => {
    for (const anchor of ['2026-11-02', '2026-11-04', '2026-11-08']) {
      expect(visibleDays(anchor, 'week').map(dateKey)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'])
    }
  })

  it('crosses month boundaries when building the work week', () => {
    expect(visibleDays('2026-12-02', 'week').map(dateKey)).toEqual(['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'])
  })

  it('shows only the selected day in day view', () => {
    expect(visibleDays('2026-11-08', 'day').map(dateKey)).toEqual(['2026-11-08'])
  })

  const directory = [
    patient({ id: 'p1', name: 'Alice Santos', patientNumber: 'PT-10001', phone: '0917-111', email: 'alice@example.test', allergyStatus: 'known', allergy: 'Penicillin' }),
    patient({ id: 'p2', name: 'Bea Cruz', patientNumber: 'PT-10002', phone: '0917-222', email: 'bea@example.test', allergyStatus: 'none', allergy: 'No known allergies' }),
    patient({ id: 'p3', name: 'Carla Diaz', patientNumber: 'PT-10003', phone: '0917-333', email: 'carla@example.test', allergyStatus: 'unknown', allergy: 'Not recorded' }),
  ]

  it('filters the directory by name, patient number, phone or email regardless of case and outer spaces', () => {
    expect(filterPatients(directory, '  ALICE ', 'all').map((item) => item.id)).toEqual(['p1'])
    expect(filterPatients(directory, 'pt-10002', 'all').map((item) => item.id)).toEqual(['p2'])
    expect(filterPatients(directory, '0917-333', 'all').map((item) => item.id)).toEqual(['p3'])
    expect(filterPatients(directory, 'carla@example', 'all').map((item) => item.id)).toEqual(['p3'])
    expect(filterPatients(directory, '', 'all')).toHaveLength(3)
    expect(filterPatients(directory, 'nobody', 'all')).toEqual([])
  })

  it.each([
    ['known', ['p1']], ['none', ['p2']], ['unrecorded', ['p3']], ['all', ['p1', 'p2', 'p3']],
  ] as const)('filters by allergy status "%s"', (allergyFilter, ids) => {
    expect(filterPatients(directory, '', allergyFilter).map((item) => item.id)).toEqual(ids)
  })

  it('combines a text query with an allergy filter', () => {
    expect(filterPatients(directory, 'cruz', 'known')).toEqual([])
    expect(filterPatients(directory, 'cruz', 'none').map((item) => item.id)).toEqual(['p2'])
  })

  it('searches the header by name, patient number or phone only after two characters', () => {
    expect(searchPatients(directory, '')).toEqual([])
    expect(searchPatients(directory, ' a ')).toEqual([])
    expect(searchPatients(directory, 'al').map((item) => item.id)).toEqual(['p1'])
    expect(searchPatients(directory, 'PT-1000').map((item) => item.id)).toEqual(['p1', 'p2', 'p3'])
    expect(searchPatients(directory, '0917-2').map((item) => item.id)).toEqual(['p2'])
  })

  it('limits header search results to five matches by default', () => {
    const many = Array.from({ length: 8 }, (_, index) => patient({ id: `m${index}`, name: `Match ${index}`, patientNumber: `PT-2${index}`, phone: '000' }))
    expect(searchPatients(many, 'match')).toHaveLength(5)
    expect(searchPatients(many, 'match', 2)).toHaveLength(2)
  })
})

describe('document upload parsing', () => {
  it('accepts a document up to the 25 MB limit and rejects anything larger', () => {
    expect(documentSizeError(0)).toBeNull()
    expect(documentSizeError(MAX_DOCUMENT_BYTES)).toBeNull()
    expect(documentSizeError(MAX_DOCUMENT_BYTES + 1)).toBe('File exceeds 25MB limit.')
  })

  it('shows the parser detail message when one is returned and a generic message otherwise', () => {
    expect(parserErrorMessage({ detail: 'Unsupported file type' })).toBe('Unsupported file type')
    expect(parserErrorMessage({ detail: 415 })).toBe('Unable to parse document.')
    expect(parserErrorMessage({})).toBe('Unable to parse document.')
    expect(parserErrorMessage('Server error')).toBe('Unable to parse document.')
    expect(parserErrorMessage(null)).toBe('Unable to parse document.')
  })

  const response = { filename: 'lab.pdf', file_type: 'pdf', page_count: 2, ocr_pages_used: [2], text: 'Synthetic result', processing_time_ms: 12 }

  it('maps a valid parser response to the review shape', () => {
    expect(parsedDocument(response)).toEqual({ filename: 'lab.pdf', fileType: 'pdf', pageCount: 2, ocrPagesUsed: [2], text: 'Synthetic result' })
    expect(parsedDocument({ ...response, ocr_pages_used: [] })?.ocrPagesUsed).toEqual([])
  })

  it.each([
    ['a non-object body', 'text'],
    ['a missing filename', { ...response, filename: undefined }],
    ['a non-string file type', { ...response, file_type: 3 }],
    ['a non-numeric page count', { ...response, page_count: '2' }],
    ['a non-array OCR list', { ...response, ocr_pages_used: 2 }],
    ['a non-integer OCR page', { ...response, ocr_pages_used: [1.5] }],
    ['a missing text field', { ...response, text: undefined }],
  ])('rejects %s', (_label, body) => {
    expect(parsedDocument(body)).toBeNull()
  })

  it('rejects a null body', () => {
    expect(parsedDocument(null)).toBeNull()
  })
})

describe('allergy names and merging', () => {
  it('splits a free-text list into trimmed names and drops blanks and repeats regardless of case', () => {
    expect(allergyNames(' Penicillin , latex; ,  PENICILLIN ,')).toEqual(['Penicillin', 'latex'])
    expect(allergyNames('   ')).toEqual([])
    expect(allergyNames('')).toEqual([])
  })

  it('keeps the documented list and adds only newly confirmed allergies', () => {
    expect(mergeAllergies('Penicillin', 'Latex, penicillin')).toBe('Penicillin, Latex')
    expect(mergeAllergies('Penicillin', '')).toBe('Penicillin')
    expect(mergeAllergies('Penicillin', 'penicillin')).toBe('Penicillin')
  })
})

describe('triage allergy reconciliation', () => {
  const known = { allergyStatus: 'known' as const, allergy: 'Penicillin' }
  const unknown = { allergyStatus: 'unknown' as const, allergy: 'Not recorded' }
  const none = { allergyStatus: 'none' as const, allergy: 'No known allergies' }

  it.each([
    ['an unrecorded chart gains a confirmed allergy', unknown, { status: 'known' as const, details: 'Latex' }, { chart: { allergyStatus: 'known', allergy: 'Latex' }, discrepancy: null }],
    ['a "none" chart gains a confirmed allergy', none, { status: 'known' as const, details: 'Latex' }, { chart: { allergyStatus: 'known', allergy: 'Latex' }, discrepancy: null }],
    ['a documented allergy is extended, never replaced', known, { status: 'known' as const, details: 'Latex' }, { chart: { allergyStatus: 'known', allergy: 'Penicillin, Latex' }, discrepancy: null }],
    ['a repeated documented allergy is not duplicated', known, { status: 'known' as const, details: 'penicillin' }, { chart: { allergyStatus: 'known', allergy: 'Penicillin' }, discrepancy: null }],
    ['an unrecorded chart becomes "no known allergies" when none is confirmed', unknown, { status: 'none' as const, details: '' }, { chart: { allergyStatus: 'none', allergy: 'No known allergies' }, discrepancy: null }],
    ['a "none" chart stays as documented when none is confirmed again', none, { status: 'none' as const, details: '' }, { chart: null, discrepancy: null }],
    ['an unrecorded chart stays unrecorded when unknown is confirmed', unknown, { status: 'unknown' as const, details: '' }, { chart: null, discrepancy: null }],
    ['a confirmed "none" is never downgraded to unknown', none, { status: 'unknown' as const, details: '' }, { chart: null, discrepancy: null }],
    ['a documented allergy is never cleared by triage: none becomes a doctor review', known, { status: 'none' as const, details: '' }, { chart: null, discrepancy: { reportedStatus: 'none', documentedAllergy: 'Penicillin' } }],
    ['a documented allergy is never cleared by triage: unknown becomes a doctor review', known, { status: 'unknown' as const, details: '' }, { chart: null, discrepancy: { reportedStatus: 'unknown', documentedAllergy: 'Penicillin' } }],
  ])('%s', (_label, chart, confirmed, expected) => {
    expect(reconcileAllergy(chart, confirmed)).toEqual(expected)
  })

  it('never returns a chart in which a documented allergy has been removed, whatever triage confirms', () => {
    for (const status of ['none', 'unknown', 'known'] as const) {
      const result = reconcileAllergy(known, { status, details: status === 'known' ? '' : 'ignored' })
      if (result.chart) expect(result.chart).toMatchObject({ allergyStatus: 'known' })
      expect(result.chart?.allergy ?? known.allergy).toContain('Penicillin')
    }
  })

  it('requires a keep-or-remove decision, and a reason before a documented allergy is removed', () => {
    expect(allergyReviewError('', '')).toBe('Choose whether to keep or remove the documented allergy.')
    expect(allergyReviewError('kept', '')).toBeNull()
    expect(allergyReviewError('removed', '')).toBe('Enter the reason for removing a documented allergy.')
    expect(allergyReviewError('removed', '   ')).toBe('Enter the reason for removing a documented allergy.')
    expect(allergyReviewError('removed', 'Ruled out by allergy testing')).toBeNull()
  })

  it('keeps the chart unchanged when the doctor keeps the allergy and records no allergy change on removal', () => {
    expect(allergyAfterReview('kept')).toBeNull()
    expect(allergyAfterReview('removed')).toEqual({ allergyStatus: 'none', allergy: 'No known allergies' })
  })
})

describe('intake session status', () => {
  const at = (hours: number, minutes: number) => new Date(2026, 10, 9, hours, minutes, 0)
  const open = { isOpen: true }

  it('is open during the day with no closing time, and is paused when staff pause it', () => {
    expect(intakeStatus(open, at(23, 59))).toBe('open')
    expect(intakeStatus({ isOpen: false }, at(9, 0))).toBe('paused')
  })

  it('stays open one minute before the closing time and expires at the closing minute', () => {
    expect(intakeStatus({ ...open, closesAt: '17:00' }, at(16, 59))).toBe('open')
    expect(intakeStatus({ ...open, closesAt: '17:00' }, at(17, 0))).toBe('expired')
    expect(intakeStatus({ ...open, closesAt: '17:00' }, at(17, 30))).toBe('expired')
  })

  it('is closed for the day once the doctor ends it, whatever the time or the pause state', () => {
    expect(intakeStatus({ isOpen: true, ended: true }, at(9, 0))).toBe('closed')
    expect(intakeStatus({ isOpen: false, ended: true, closesAt: '17:00' }, at(18, 0))).toBe('closed')
  })

  it('reports an expired time before a pause, so the closing time is what staff see', () => {
    expect(intakeStatus({ isOpen: false, closesAt: '17:00' }, at(17, 5))).toBe('expired')
  })

  it('reads minutes of the day from the local clock', () => {
    expect(minutesOfDay(at(16, 59))).toBe(16 * 60 + 59)
    expect(minutesOfDay(at(0, 0))).toBe(0)
  })

  it('offers closing times every half hour from 08:00 to 20:00', () => {
    const times = closingTimeOptions()
    expect(times).toHaveLength(25)
    expect(times[0]).toBe('08:00')
    expect(times[times.length - 1]).toBe('20:00')
    expect(times).toContain('17:00')
    expect(times).not.toContain('17:15')
  })
})

describe('what the patient writes at check-in', () => {
  it('records trimmed text and treats blank text as nothing', () => {
    expect(reportedText('  Headache since yesterday  ')).toBe('Headache since yesterday')
    expect(reportedText('   ')).toBeUndefined()
    expect(reportedText('')).toBeUndefined()
  })

  it('accepts text up to the limits and rejects anything longer', () => {
    expect(reportedTextError('a'.repeat(REASON_MAX_LENGTH), 'b'.repeat(SYMPTOMS_MAX_LENGTH))).toBeNull()
    expect(reportedTextError('a'.repeat(REASON_MAX_LENGTH + 1), '')).toMatch(/under 160 characters/)
    expect(reportedTextError('', 'b'.repeat(SYMPTOMS_MAX_LENGTH + 1))).toMatch(/under 500 characters/)
  })

  it('does not count surrounding spaces against the limit', () => {
    expect(reportedTextError(`  ${'a'.repeat(REASON_MAX_LENGTH)}  `, '')).toBeNull()
  })
})

describe('online booking availability', () => {
  const now = new Date(2026, 10, 9, 9, 0, 0)
  const tomorrow = '2026-11-10'
  const booked = (overrides: Partial<Appointment> = {}) => appointment({ date: tomorrow, time: '10:00', duration: 30, patientId: 'patient-b', ...overrides })

  it('shows each slot as open, booked, or not open online, and never includes a patient detail', () => {
    const slots = dayAvailability(tomorrow, [booked()], { accepting: true, now })
    expect(slots.find((slot) => slot.time === '10:00')).toEqual({ time: '10:00', status: 'booked' })
    expect(slots.find((slot) => slot.time === '10:30')).toEqual({ time: '10:30', status: 'open' })
    expect(JSON.stringify(slots)).not.toMatch(/patient|Bea|name/i)
    expect(dayAvailability(tomorrow, [], { accepting: false, now }).every((slot) => slot.status === 'not-accepting')).toBe(true)
  })

  it('blocks only the slots a longer visit overlaps, and a visit that ends exactly at a slot does not block it', () => {
    const slots = dayAvailability(tomorrow, [booked({ time: '09:45', duration: 45 })], { accepting: true, now })
    expect(slots.find((slot) => slot.time === '09:00')?.status).toBe('open')
    expect(slots.find((slot) => slot.time === '09:30')?.status).toBe('booked')
    expect(slots.find((slot) => slot.time === '10:00')?.status).toBe('booked')
    expect(slots.find((slot) => slot.time === '10:30')?.status).toBe('open')
  })

  it('ignores cancelled bookings', () => {
    const slots = dayAvailability(tomorrow, [booked({ status: 'cancelled' })], { accepting: true, now })
    expect(slots.find((slot) => slot.time === '10:00')?.status).toBe('open')
  })

  it('marks a slot as passed once its start time has been reached today, and every slot of a past day as passed', () => {
    const today = dayAvailability('2026-11-09', [], { accepting: true, now })
    expect(today.find((slot) => slot.time === '09:00')?.status).toBe('passed')
    expect(today.find((slot) => slot.time === '09:30')?.status).toBe('open')
    expect(dayAvailability('2026-11-08', [], { accepting: true, now }).every((slot) => slot.status === 'passed')).toBe(true)
  })

  it('formats clinic times in 12-hour form', () => {
    expect(formatTime('00:30')).toBe('12:30 AM')
    expect(formatTime('09:05')).toBe('9:05 AM')
    expect(formatTime('12:00')).toBe('12:00 PM')
    expect(formatTime('17:30')).toBe('5:30 PM')
  })

  it('adds calendar days across a month boundary', () => {
    expect(dateKey(addDays(new Date(2026, 10, 30), 1))).toBe('2026-12-01')
    expect(dateKey(addDays(new Date(2026, 0, 1), -1))).toBe('2025-12-31')
  })
})

describe('online booking rules', () => {
  const now = new Date(2026, 10, 9, 9, 0, 0)
  const tomorrow = '2026-11-10'
  const request = { patientId: 'p-1001', date: tomorrow, time: '11:00', reason: '' }
  const state = { appointments: [] as Appointment[], acceptingDates: [tomorrow], now }

  it('accepts an open time on a day the doctor has opened, and a slot later today that has not yet started', () => {
    expect(onlineBookingError(request, state)).toBeNull()
    expect(onlineBookingError({ ...request, date: '2026-11-09', time: '09:30' }, { ...state, acceptingDates: ['2026-11-09'] })).toBeNull()
  })

  it.each([
    ['no signed-in patient', { patientId: '' }, 'Sign in to book an online appointment.'],
    ['an impossible date', { date: '2026-02-30' }, 'Choose a valid date.'],
    ['a day that has passed', { date: '2026-11-08' }, 'Choose today or a later date.'],
    ['a day beyond the booking window', { date: '2027-01-15' }, `Online booking opens up to ${ONLINE_BOOKING_DAYS} days ahead.`],
    ['a day the doctor has not opened', { date: '2026-11-11' }, 'Dr. Reyes is not accepting online bookings on that date. Please call the clinic or ask reception.'],
    ['a time that is not a clinic start time', { time: '07:30' }, 'Choose a time from the list.'],
    ['a reason longer than the limit', { reason: 'a'.repeat(REASON_MAX_LENGTH + 1) }, 'Keep the reason for your visit under 160 characters.'],
  ])('refuses %s', (_label, change, message) => {
    expect(onlineBookingError({ ...request, ...change }, state)).toBe(message)
  })

  it('refuses a time that has already started today, even on an open day', () => {
    expect(onlineBookingError({ ...request, date: '2026-11-09', time: '09:00' }, { ...state, acceptingDates: ['2026-11-09'] })).toBe('That time has already passed. Choose a later time.')
  })

  it('allows one online booking per day for a patient, and an earlier cancelled booking does not count', () => {
    const own = appointment({ patientId: 'p-1001', date: tomorrow, time: '09:00', status: 'scheduled' })
    expect(onlineBookingError(request, { ...state, appointments: [own] })).toBe('You already have an appointment on this day.')
    expect(onlineBookingError(request, { ...state, appointments: [{ ...own, status: 'cancelled' }] })).toBeNull()
  })

  it('refuses a slot that a staff booking already occupies', () => {
    const other = appointment({ patientId: 'patient-b', date: tomorrow, time: '10:45', duration: 30, status: 'confirmed' })
    expect(onlineBookingError(request, { ...state, appointments: [other] })).toBe('That time overlaps an existing appointment. Choose another slot.')
  })

  it('adds and removes a day from the open list, keeping it sorted and free of duplicates', () => {
    expect(toggleOnlineDate([], tomorrow)).toEqual([tomorrow])
    expect(toggleOnlineDate(['2026-11-12'], tomorrow)).toEqual([tomorrow, '2026-11-12'])
    expect(toggleOnlineDate([tomorrow, '2026-11-12'], tomorrow)).toEqual(['2026-11-12'])
    expect(toggleOnlineDate([tomorrow], tomorrow)).not.toContain(tomorrow)
  })
})


describe('optional triage and the doctor-confirmed allergy outcome', () => {
  const triage = { complaint: '', notes: '', bloodPressure: '', weight: '', temperature: '' }

  it('lets the attendant record vitals once for a waiting patient, and never for a finished or already triaged one', () => {
    expect(canRecordTriage(entry({ stage: 'ready' }))).toBe(true)
    expect(canRecordTriage(entry({ stage: 'triage' }))).toBe(true)
    expect(canRecordTriage(entry({ stage: 'ready', triage }))).toBe(false)
    expect(canRecordTriage(entry({ stage: 'consulting' }))).toBe(false)
    expect(canRecordTriage(entry({ stage: 'ready', status: 'completed' }))).toBe(false)
    expect(canRecordTriage(entry({ stage: undefined }))).toBe(false)
  })

  it('counts a patient as waiting for the doctor whether or not triage was recorded', () => {
    expect(isAwaitingDoctor(entry({ stage: 'ready' }))).toBe(true)
    expect(isAwaitingDoctor(entry({ stage: 'ready', triage }))).toBe(true)
    expect(isAwaitingDoctor(entry({ stage: 'triage' }))).toBe(true)
    expect(isAwaitingDoctor(entry({ stage: 'consulting' }))).toBe(false)
    expect(isAwaitingDoctor(entry({ stage: 'complete', status: 'completed' }))).toBe(false)
    expect(isAwaitingDoctor(entry({ stage: 'ready', status: 'completed' }))).toBe(false)
  })

  it.each([
    ['', '', 'Confirm the patient’s allergy status with the patient.'],
    ['known', '  ', 'Enter the confirmed allergy details.'],
    ['known', 'Penicillin', null],
    ['none', '', null],
    ['unknown', '', null],
  ] as const)('allergy confirmation %s / "%s" gives %s', (status, details, expected) => {
    expect(allergyConfirmationError(status, details)).toBe(expected)
  })

  const penicillin = { allergyStatus: 'known', allergy: 'Penicillin' } as const
  const unknown = { allergyStatus: 'unknown', allergy: 'Not recorded' } as const

  it('passes a conflict raised at triage through unchanged and ignores any new confirmation', () => {
    const raised = { reportedStatus: 'none', documentedAllergy: 'Penicillin' } as const
    expect(visitAllergyOutcome(penicillin, raised, { status: 'known', details: 'Latex' })).toEqual({ chart: null, discrepancy: raised })
  })

  it('changes nothing when nothing was confirmed and no conflict exists', () => {
    expect(visitAllergyOutcome(penicillin, undefined, undefined)).toEqual({ chart: null, discrepancy: null })
  })

  it('records what the doctor confirmed when the chart had no documented allergy', () => {
    expect(visitAllergyOutcome(unknown, undefined, { status: 'known', details: 'Latex' })).toEqual({ chart: { allergyStatus: 'known', allergy: 'Latex' }, discrepancy: null })
    expect(visitAllergyOutcome(unknown, undefined, { status: 'none', details: '' })).toEqual({ chart: { allergyStatus: 'none', allergy: 'No known allergies' }, discrepancy: null })
  })

  it('keeps a documented allergy and raises a conflict when the confirmed status is none or unknown', () => {
    expect(visitAllergyOutcome(penicillin, undefined, { status: 'none', details: '' })).toEqual({ chart: null, discrepancy: { reportedStatus: 'none', documentedAllergy: 'Penicillin' } })
    expect(visitAllergyOutcome(penicillin, undefined, { status: 'unknown', details: '' })).toEqual({ chart: null, discrepancy: { reportedStatus: 'unknown', documentedAllergy: 'Penicillin' } })
  })

  it('adds newly confirmed allergies to the documented list', () => {
    expect(visitAllergyOutcome(penicillin, undefined, { status: 'known', details: 'Latex' }).chart).toEqual({ allergyStatus: 'known', allergy: 'Penicillin, Latex' })
  })
})


describe('queue lanes: seniors and pediatric patients are seen first', () => {
  it.each([
    [0, 'priority', 'Pediatric'], [PEDIATRIC_MAX_AGE, 'priority', 'Pediatric'], [PEDIATRIC_MAX_AGE + 1, 'regular', null],
    [30, 'regular', null], [SENIOR_MIN_AGE - 1, 'regular', null], [SENIOR_MIN_AGE, 'priority', 'Senior'], [95, 'priority', 'Senior'],
  ] as const)('age %s goes to the %s lane', (age, lane, reason) => {
    expect(laneForAge(age)).toBe(lane)
    expect(priorityReason(age)).toBe(reason)
  })

  it('treats an unreadable date of birth as regular rather than guessing priority', () => {
    expect(laneForAge(null)).toBe('regular')
    expect(priorityReason(null)).toBeNull()
  })

  it('treats tickets saved before lanes existed as regular, and names both lanes for people', () => {
    expect(entryLane(entry({ lane: undefined }))).toBe('regular')
    expect(entryLane(entry({ lane: 'priority' }))).toBe('priority')
    expect(laneLabel('priority')).toBe('Priority (senior & pediatric)')
    expect(laneLabel('regular')).toBe('Regular (adult)')
    expect(laneLabel('urgent')).toBe('Urgent (seen first)')
  })

  it('counts ticket numbers within each lane so a senior is not numbered behind every adult', () => {
    const issued = [entry({ lane: 'regular' }), entry({ lane: undefined }), entry({ lane: 'regular' }), entry({ lane: 'priority' })]
    expect(nextTicketNumber(issued, 'regular')).toBe('R-004')
    expect(nextTicketNumber(issued, 'priority')).toBe('P-002')
    expect(nextTicketNumber([], 'priority')).toBe('P-001')
  })

  const at = (minute: number) => `2026-11-09T01:${String(minute).padStart(2, '0')}:00.000Z`
  const line = () => [
    entry({ id: 'adult-1', number: 'R-001', lane: 'regular', joinedAt: at(0), stage: 'ready' }),
    entry({ id: 'senior-1', number: 'P-001', lane: 'priority', joinedAt: at(5), stage: 'ready' }),
    entry({ id: 'adult-2', number: 'R-002', lane: 'regular', joinedAt: at(6), stage: 'ready' }),
    entry({ id: 'child-1', number: 'P-002', lane: 'priority', joinedAt: at(9), stage: 'ready' }),
  ]

  it('calls the priority lane first, then arrival order within each lane', () => {
    expect(waitingOrder(line()).map((item) => item.id)).toEqual(['senior-1', 'child-1', 'adult-1', 'adult-2'])
    expect(queueSnapshot(line()).nextWaiting?.id).toBe('senior-1')
  })

  it('calls an urgent ticket before the priority and regular lanes, whenever it arrived', () => {
    const urgent = entry({ id: 'urgent-1', number: 'U-001', lane: 'urgent', joinedAt: at(30), stage: 'ready' })
    const urgentLater = entry({ id: 'urgent-2', number: 'U-002', lane: 'urgent', joinedAt: at(40), stage: 'ready' })
    expect(waitingOrder([urgentLater, ...line(), urgent]).map((item) => item.id)).toEqual(['urgent-1', 'urgent-2', 'senior-1', 'child-1', 'adult-1', 'adult-2'])
    expect(queueSnapshot([...line(), urgent]).nextWaiting?.id).toBe('urgent-1')
    expect(nextTicketNumber([urgent, ...line()], 'urgent')).toBe('U-002')
  })

  it('keeps arrival order for tickets that arrived at the same time', () => {
    const tied = [entry({ id: 'b', lane: 'regular', joinedAt: at(0), stage: 'ready' }), entry({ id: 'a', lane: 'regular', joinedAt: at(0), stage: 'ready' })]
    expect(waitingOrder(tied).map((item) => item.id)).toEqual(['b', 'a'])
  })

  it('does not put a patient already being seen, called, or finished into the waiting order', () => {
    const entries = [
      entry({ id: 'seen', stage: 'complete', status: 'completed' }), entry({ id: 'room', stage: 'consulting' }),
      entry({ id: 'called', status: 'called', stage: 'ready' }), entry({ id: 'waiting', stage: 'ready' }),
    ]
    expect(waitingOrder(entries).map((item) => item.id)).toEqual(['waiting'])
  })

  it('shows how many patients are ahead of a ticket, and nothing for a ticket that is not waiting', () => {
    expect(peopleAhead(line(), 'senior-1')).toBe(0)
    expect(peopleAhead(line(), 'adult-1')).toBe(2)
    expect(peopleAhead(line(), 'adult-2')).toBe(3)
    expect(peopleAhead([entry({ id: 'room', stage: 'consulting' })], 'room')).toBeNull()
    expect(peopleAhead(line(), 'missing')).toBeNull()
  })

  it('reports the current number: the consultation first, otherwise a called ticket, otherwise nobody', () => {
    expect(nowServing(line())).toBeUndefined()
    expect(nowServing([entry({ id: 'called', status: 'called', stage: 'ready' })])?.id).toBe('called')
    expect(nowServing([entry({ id: 'called', status: 'called', stage: 'ready' }), entry({ id: 'room', stage: 'consulting' })])?.id).toBe('room')
  })

  it('orders the doctor’s list: in progress, then waiting in call order, then finished', () => {
    const entries = [
      entry({ id: 'done', stage: 'complete', status: 'completed', joinedAt: at(0) }),
      ...line(),
      entry({ id: 'room', stage: 'consulting', joinedAt: at(2) }),
    ]
    expect(queueDisplayOrder(entries).map((item) => item.id)).toEqual(['room', 'senior-1', 'child-1', 'adult-1', 'adult-2', 'done'])
  })

  it('words a patient’s standing for each situation', () => {
    const entries = line()
    expect(ticketStanding(entries, entries[1])).toBe('You are next.')
    expect(ticketStanding(entries, entries[0])).toBe('2 people are ahead of you.')
    expect(ticketStanding(entries, entries[3])).toBe('1 person is ahead of you.')
    const room = entry({ id: 'room', stage: 'consulting' })
    expect(ticketStanding([room], room)).toBe('It’s your turn. Please go to the doctor.')
    const done = entry({ id: 'done', stage: 'complete', status: 'completed' })
    expect(ticketStanding([done], done)).toBe('Your visit is complete.')
    const called = entry({ id: 'called', status: 'called', stage: 'ready' })
    expect(ticketStanding([entry({ id: 'other', status: 'called', stage: 'ready' }), called], called)).toBe('Please wait. The clinic will call you.')
  })
})

describe('manual queue entry by staff', () => {
  const today = new Date(2026, 10, 9, 9, 0, 0)
  const form = (overrides: Partial<ManualQueueForm> = {}): ManualQueueForm => ({
    name: 'Walk In Person', birthDate: '1990-05-10', sex: 'Female', phone: '', reason: '', urgent: false, ...overrides,
  })

  it('accepts a patient with only a name, date of birth and sex, with no phone or reason', () => {
    expect(manualQueueError(form(), today)).toBeNull()
  })

  it.each([
    [{ name: '   ' }, 'Enter the patient’s name to continue.'],
    [{ birthDate: '' }, 'Enter the patient’s date of birth. Use the best estimate if it is not known.'],
    [{ birthDate: '2026-02-30' }, 'Enter a valid date of birth that is not in the future.'],
    [{ birthDate: '2026-11-10' }, 'Enter a valid date of birth that is not in the future.'],
    [{ sex: '' }, 'Select the patient’s sex, or Unknown.'],
  ])('refuses %j', (overrides, message) => {
    expect(manualQueueError(form(overrides), today)).toBe(message)
  })

  it('accepts a date of birth that is today', () => {
    expect(manualQueueError(form({ birthDate: '2026-11-09' }), today)).toBeNull()
  })

  it('requires a reason for an urgent ticket, but not for a regular one', () => {
    expect(manualQueueError(form({ urgent: true, reason: '  ' }), today)).toBe('Enter why this patient is urgent.')
    expect(manualQueueError(form({ urgent: true, reason: 'Chest pain' }), today)).toBeNull()
    expect(manualQueueError(form({ urgent: false, reason: '' }), today)).toBeNull()
  })

  it('keeps a reason within the length limit', () => {
    expect(manualQueueError(form({ reason: 'x'.repeat(REASON_MAX_LENGTH) }), today)).toBeNull()
    expect(manualQueueError(form({ reason: 'x'.repeat(REASON_MAX_LENGTH + 1) }), today)).toBe(`Keep the reason for your visit under ${REASON_MAX_LENGTH} characters.`)
  })

  it('puts an urgent patient in the urgent lane whatever their age, and everyone else by age', () => {
    expect(manualQueueLane(true, 35)).toBe('urgent')
    expect(manualQueueLane(true, null)).toBe('urgent')
    expect(manualQueueLane(false, 70)).toBe('priority')
    expect(manualQueueLane(false, 35)).toBe('regular')
    expect(manualQueueLane(false, null)).toBe('regular')
  })
})
