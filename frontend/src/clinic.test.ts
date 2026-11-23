import { describe, expect, it, vi } from 'vitest'
import {
  ageFromBirthDate, dateKey, hasAppointmentConflict, isQueueSession,
  isClosingTime, isStoredAppointments, isStoredDateList, parseStoredPatients, readStored, saveStored,
} from './clinic'
import { appointment, patient, queue } from './test/fixtures'

describe('clinic dates', () => {
  it('uses the local calendar date with zero-padded month and day', () => {
    expect(dateKey(new Date(2026, 0, 2, 23, 45))).toBe('2026-01-02')
  })

  it.each([
    ['1990-05-10', new Date(2026, 4, 9), 35],
    ['1990-05-10', new Date(2026, 4, 10), 36],
    ['1990-05-10', new Date(2026, 4, 11), 36],
    ['2026-05-10', new Date(2026, 4, 10), 0],
    ['', new Date(2026, 4, 10), null],
    ['2027-05-10', new Date(2026, 4, 10), null],
    ['2026-02-30', new Date(2026, 4, 10), null],
    ['not-a-date', new Date(2026, 4, 10), null],
  ])('calculates age for DOB %s as of %s', (birthDate, now, expected) => {
    expect(ageFromBirthDate(birthDate, now)).toBe(expected)
  })
})

describe('appointment scheduling', () => {
  it.each(['scheduled', 'confirmed', 'checked_in'] as const)('blocks overlap with %s appointments', (status) => {
    expect(hasAppointmentConflict(appointment({ time: '09:00', duration: 60 }), [appointment({ time: '09:30', status })])).toBe(true)
  })

  it.each(['cancelled', 'completed'] as const)('allows reuse of a %s appointment slot', (status) => {
    expect(hasAppointmentConflict(appointment(), [appointment({ status })])).toBe(false)
  })

  it.each([
    ['08:30', 30, false], ['09:30', 30, false], ['09:00', 30, true],
    ['08:30', 45, true], ['09:15', 30, true], ['08:00', 120, true],
  ])('handles boundary/containment case %s for %s minutes', (time, duration, conflict) => {
    expect(hasAppointmentConflict(appointment({ time, duration }), [appointment()])).toBe(conflict)
  })

  it('allows the same time on another date', () => {
    expect(hasAppointmentConflict(appointment({ date: '2030-01-02' }), [appointment({ date: '2030-01-01' })])).toBe(false)
  })
})

describe('stored demo data validation', () => {
  it('preserves valid patients and empty directories', () => {
    expect(parseStoredPatients([patient()])).toEqual([patient()])
    expect(parseStoredPatients([])).toEqual([])
  })

  it('accepts new document records and migrates older charts to an empty document list', () => {
    const document = { id: 'doc-1', filename: 'lab.pdf', fileType: 'pdf', pageCount: 2, ocrPagesUsed: [2], extractedAt: '2026-11-14T09:00:00.000Z', text: 'Reviewed result' }
    expect(parseStoredPatients([patient({ documents: [document] })])?.[0].documents).toEqual([document])
    const legacy: Record<string, unknown> = { ...patient() }
    delete legacy.documents
    expect(parseStoredPatients([legacy])?.[0].documents).toEqual([])
  })

  it('rejects invalid saved document metadata rather than dropping a chart', () => {
    expect(parseStoredPatients([patient({ documents: [{ id: 'bad', filename: 'scan.pdf', fileType: 'pdf', pageCount: 0, ocrPagesUsed: [], extractedAt: 'today', text: 'x' }] })])).toBeNull()
    expect(parseStoredPatients([patient({ documents: [{ id: 'bad', filename: 'scan.pdf', fileType: 'pdf', pageCount: 1, ocrPagesUsed: ['one'], extractedAt: 'today', text: 'x' } as never] })])).toBeNull()
  })

  it.each([
    ['No known allergies', 'none'], ['Not recorded', 'unknown'], ['Latex', 'known'],
  ])('migrates the legacy gender and inferred allergy status for %s', (allergy, status) => {
    const legacy: Record<string, unknown> = { ...patient({ allergy }), gender: 'Female' }
    delete legacy.sex
    delete legacy.allergyStatus
    expect(parseStoredPatients([legacy])?.[0]).toMatchObject({ sex: 'Female', allergyStatus: status })
  })

  it('keeps legacy charts without sex or gender readable as unrecorded', () => {
    const legacy: Record<string, unknown> = { ...patient() }
    delete legacy.sex
    expect(parseStoredPatients([legacy])?.[0].sex).toBe('')
  })

  it.each([null, {}, [null], [{ ...patient(), records: null }], [{ ...patient(), joined: 'bad-date' }], [{ ...patient(), birthDate: '2026-02-30' }], [{ ...patient(), allergyStatus: 'invalid' }], [{ ...patient(), allergyStatus: ['known'] }]])('rejects malformed patient storage %#', (value) => {
    expect(parseStoredPatients(value)).toBeNull()
  })

  it('reads existing visit summaries without interview notes', () => {
    const oldRecord = { id: 'r-old', date: '2026-01-02', signs: '', symptoms: '', diagnosis: 'Review' }
    expect(parseStoredPatients([patient({ records: [oldRecord] })])?.[0].records).toEqual([oldRecord])
  })

  it.each([null, {}, [{ ...appointment(), time: '99:99' }], [{ ...appointment(), duration: 0 }], [{ ...appointment(), date: '2026-02-30' }], [{ ...appointment(), status: 'invalid' }], [{ ...appointment(), status: ['scheduled'] }]])('rejects malformed appointment storage %#', (value) => {
    expect(isStoredAppointments(value)).toBe(false)
  })

  it('accepts valid appointment storage', () => {
    expect(isStoredAppointments([appointment()])).toBe(true)
    expect(isStoredAppointments([])).toBe(true)
  })

  it.each([null, {}, { ...queue(), entries: null }, { ...queue(), isOpen: 'yes' }, { ...queue(), entries: [{ joinedAt: 'invalid' }] }, { ...queue(), entries: [{ id: 'q1', number: '001', name: 'Alice', phone: '123', joinedAt: '2026-01-01T10:00:00Z', status: ['waiting'] }] }])('rejects malformed queue storage %#', (value) => {
    expect(isQueueSession(value)).toBe(false)
  })

  it('accepts a complete queue session', () => {
    expect(isQueueSession(queue({ entries: [{ id: 'q1', number: '001', name: 'Alice', phone: '123', joinedAt: new Date().toISOString(), status: 'waiting' }] }))).toBe(true)
  })

  it('returns a fallback for missing, invalid JSON, or wrong-shaped storage', () => {
    const fallback = () => [appointment()]
    for (const raw of [null, '{', 'null', '{}']) {
      if (raw === null) localStorage.removeItem('appointments')
      else localStorage.setItem('appointments', raw)
      expect(readStored('appointments', fallback, isStoredAppointments)).toEqual(fallback())
    }
  })

  it('reads valid persisted data without calling the fallback', () => {
    const saved = [appointment()]
    localStorage.setItem('appointments', JSON.stringify(saved))
    const fallback = vi.fn(() => [])
    expect(readStored('appointments', fallback, isStoredAppointments)).toEqual(saved)
    expect(fallback).not.toHaveBeenCalled()
  })

  it('handles denied browser storage access', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError') })
    expect(readStored('appointments', () => [], isStoredAppointments)).toEqual([])
  })

  it('persists JSON and removes an expired queue key', () => {
    expect(saveStored('session', queue())).toBe(true)
    expect(JSON.parse(localStorage.getItem('session')!)).toEqual(queue())
    expect(saveStored('session', null)).toBe(true)
    expect(localStorage.getItem('session')).toBeNull()
  })

  it('reports quota failures without throwing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError') })
    expect(saveStored('session', queue())).toBe(false)
  })
})

describe('allergy review storage', () => {
  const discrepancy = { reportedStatus: 'none', documentedAllergy: 'Penicillin' }
  const review = { decision: 'kept', reportedStatus: 'none', documentedAllergy: 'Penicillin', reason: '' }
  const ticket = (overrides: Record<string, unknown>) => ({ id: 'q1', number: '001', name: 'Alice', phone: '123', joinedAt: '2026-01-01T10:00:00Z', status: 'waiting', ...overrides })

  it('accepts a queue entry with a well-formed allergy discrepancy', () => {
    expect(isQueueSession(queue({ entries: [ticket({ allergyDiscrepancy: discrepancy }) as never] }))).toBe(true)
  })

  it.each([
    { reportedStatus: 'known', documentedAllergy: 'Penicillin' },
    { reportedStatus: 'none' },
    'not-an-object',
  ])('rejects a malformed queue discrepancy %#', (value) => {
    expect(isQueueSession(queue({ entries: [ticket({ allergyDiscrepancy: value }) as never] }))).toBe(false)
  })

  it.each(['urgent', 'priority', 'regular', undefined])('accepts a queue ticket in the %s lane', (lane) => {
    expect(isQueueSession(queue({ entries: [ticket({ lane }) as never] }))).toBe(true)
  })

  it.each(['Doctor', 'Attendant', undefined])('accepts a queue ticket added by %s', (addedBy) => {
    expect(isQueueSession(queue({ entries: [ticket({ addedBy }) as never] }))).toBe(true)
  })

  it.each(['Patient', 'doctor', 7, null])('rejects a queue ticket with the addedBy value %s', (addedBy) => {
    expect(isQueueSession(queue({ entries: [ticket({ addedBy }) as never] }))).toBe(false)
  })

  it.each(['vip', 3, null])('rejects a queue ticket with the lane %s', (lane) => {
    expect(isQueueSession(queue({ entries: [ticket({ lane }) as never] }))).toBe(false)
  })

  it('accepts a chart record with a doctor allergy review and rejects malformed reviews', () => {
    const record = { id: 'r1', date: '2026-11-09', signs: '', symptoms: '', diagnosis: 'Headache', allergyReview: review }
    expect(parseStoredPatients([patient({ records: [record] as never })])).not.toBeNull()
    expect(parseStoredPatients([patient({ records: [{ ...record, allergyReview: { ...review, decision: 'deleted' } }] as never })])).toBeNull()
    expect(parseStoredPatients([patient({ records: [{ ...record, allergyReview: { ...review, reason: 3 } }] as never })])).toBeNull()
    expect(parseStoredPatients([patient({ records: [{ ...record, allergyReview: { ...review, reportedStatus: 'known' } }] as never })])).toBeNull()
    expect(parseStoredPatients([patient({ records: [{ ...record, allergyReview: 'kept' }] as never })])).toBeNull()
  })
})

describe('intake session and check-in text storage', () => {
  const ticket = (overrides: Record<string, unknown>) => ({ id: 'q1', number: '001', name: 'Alice', phone: '123', joinedAt: '2026-01-01T10:00:00Z', status: 'waiting', ...overrides })

  it.each(['08:00', '17:00', '23:59', '00:00'])('accepts %s as a closing time', (value) => {
    expect(isClosingTime(value)).toBe(true)
  })

  it.each(['24:00', '8:00', '17:60', '', '5pm', 1700, null])('rejects %j as a closing time', (value) => {
    expect(isClosingTime(value)).toBe(false)
  })

  it('accepts a session that has been ended and has a closing time, and sessions from before these fields existed', () => {
    expect(isQueueSession(queue({ ended: true, closesAt: '17:00' }))).toBe(true)
    expect(isQueueSession(queue({ ended: false }))).toBe(true)
    expect(isQueueSession(queue())).toBe(true)
  })

  it.each([{ ended: 'yes' }, { closesAt: '5pm' }, { closesAt: 1700 }])('rejects a malformed session field %j', (fields) => {
    expect(isQueueSession(queue(fields as never))).toBe(false)
  })

  it('accepts what the patient wrote at check-in and rejects a non-text value', () => {
    expect(isQueueSession(queue({ entries: [ticket({ reportedReason: 'Headache', reportedSymptoms: 'Throbbing' }) as never] }))).toBe(true)
    expect(isQueueSession(queue({ entries: [ticket({ reportedSymptoms: 3 }) as never] }))).toBe(false)
    expect(isQueueSession(queue({ entries: [ticket({ reportedReason: null }) as never] }))).toBe(false)
  })
})

describe('online booking storage', () => {
  it('accepts appointments booked online or by staff, and rejects an unknown source', () => {
    expect(isStoredAppointments([appointment({ source: 'online' }) as never])).toBe(true)
    expect(isStoredAppointments([appointment({ source: 'staff' }) as never])).toBe(true)
    expect(isStoredAppointments([appointment({ source: 'walk-in' as never }) as never])).toBe(false)
  })

  it('stores the days the doctor has opened for online booking as valid date keys only', () => {
    expect(isStoredDateList([])).toBe(true)
    expect(isStoredDateList(['2026-11-10', '2026-11-12'])).toBe(true)
    expect(isStoredDateList(['2026-02-30'])).toBe(false)
    expect(isStoredDateList('2026-11-10')).toBe(false)
    expect(isStoredDateList([20261110])).toBe(false)
  })
})
