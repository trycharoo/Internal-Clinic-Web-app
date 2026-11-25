export type AllergyStatus = 'unknown' | 'none' | 'known'
export type PatientDocument = {
  id: string
  filename: string
  fileType: string
  pageCount: number
  ocrPagesUsed: number[]
  extractedAt: string
  text: string
}
export type Patient = {
  id: string
  name: string
  initials: string
  birthDate: string
  sex: string
  phone: string
  email: string
  patientNumber: string
  joined: string
  allergy: string
  allergyStatus: AllergyStatus
  lastVisit: string
  notes: string
  records: MedicalRecord[]
  prescriptions: Prescription[]
  documents?: PatientDocument[]
}
// A documented allergy that triage could not confirm. It stays on the chart until the doctor decides.
export type AllergyDiscrepancy = { reportedStatus: 'none' | 'unknown'; documentedAllergy: string }
// The doctor's recorded decision on a discrepancy, kept with the visit it was made in.
export type AllergyReview = { decision: 'kept' | 'removed'; reportedStatus: 'none' | 'unknown'; documentedAllergy: string; reason: string }
export type MedicalRecord = { id: string; date: string; signs: string; symptoms: string; diagnosis: string; notes?: string; encounterId?: string; triage?: QueueEntry['triage']; allergyReview?: AllergyReview }
export type Prescription = {
  id: string
  date: string
  medication: string
  strength: string
  instructions: string
  duration: string
  notes: string
  encounterId?: string
}
export type Appointment = {
  id: string
  patientId: string
  date: string
  time: string
  duration: number
  reason: string
  status: 'scheduled' | 'confirmed' | 'checked_in' | 'completed' | 'cancelled'
  clinician: string
  // Booked by the patient online, or entered by staff. Absent on older bookings, which count as staff bookings.
  source?: 'staff' | 'online'
}
// Urgent: staff-flagged emergency, seen before everyone. Priority: seniors and pediatric patients. Regular: adults.
// Priority and regular are chosen from the date of birth at check-in. Urgent is only ever set by staff.
export type QueueLane = 'urgent' | 'priority' | 'regular'
// Who added a ticket by hand instead of the patient scanning the QR.
export type QueueAddedBy = 'Doctor' | 'Attendant'
export type QueueEntry = {
  id: string
  number: string
  name: string
  phone: string
  joinedAt: string
  status: 'waiting' | 'called' | 'completed'
  patientId?: string
  birthDate?: string
  reportedAllergyStatus?: AllergyStatus
  reportedAllergy?: string
  stage?: 'triage' | 'ready' | 'consulting' | 'complete'
  triage?: { complaint: string; notes: string; bloodPressure: string; weight: string; temperature: string }
  encounterId?: string
  allergyDiscrepancy?: AllergyDiscrepancy
  // What the patient wrote at check-in, in their own words. Unverified until staff confirm it at triage.
  reportedReason?: string
  reportedSymptoms?: string
  // Absent on older tickets, which count as regular.
  lane?: QueueLane
  // Present only on tickets staff added manually. Absent means the patient checked in with the QR.
  addedBy?: QueueAddedBy
}
export type QueueSession = {
  date: string
  token: string
  isOpen: boolean
  entries: QueueEntry[]
  // The doctor ended today's intake. Absent on older sessions, which means not ended.
  ended?: boolean
  // Local clinic time (HH:MM) after which check-in closes automatically. Absent means until the day ends.
  closesAt?: string
}

export function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00`)
  return !Number.isNaN(date.getTime()) && dateKey(date) === value
}

export function ageFromBirthDate(birthDate: string, today = new Date()) {
  if (!isDateKey(birthDate) || birthDate > dateKey(today)) return null
  const birth = new Date(`${birthDate}T12:00:00`)
  let age = today.getFullYear() - birth.getFullYear()
  if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age--
  return age
}

export function hasAppointmentConflict(candidate: Pick<Appointment, 'date' | 'time' | 'duration'>, appointments: Appointment[]) {
  const minutes = (time: string) => {
    const [hours, mins] = time.split(':').map(Number)
    return hours * 60 + mins
  }
  const start = minutes(candidate.time)
  return appointments.some((appointment) => {
    if (appointment.date !== candidate.date || !['scheduled', 'confirmed', 'checked_in'].includes(appointment.status)) return false
    const otherStart = minutes(appointment.time)
    return start < otherStart + appointment.duration && start + candidate.duration > otherStart
  })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasStrings(value: Record<string, unknown>, keys: string[]) {
  return keys.every((key) => typeof value[key] === 'string')
}

function isAllergyDiscrepancy(value: unknown): value is AllergyDiscrepancy {
  return isObject(value) && hasStrings(value, ['documentedAllergy'])
    && (value.reportedStatus === 'none' || value.reportedStatus === 'unknown')
}

function isAllergyReview(value: unknown): value is AllergyReview {
  return isObject(value) && hasStrings(value, ['documentedAllergy', 'reason'])
    && (value.decision === 'kept' || value.decision === 'removed')
    && (value.reportedStatus === 'none' || value.reportedStatus === 'unknown')
}

function isMedicalRecord(value: unknown): value is MedicalRecord {
  return isObject(value) && hasStrings(value, ['id', 'signs', 'symptoms', 'diagnosis'])
    && isDateKey(value.date) && (value.notes === undefined || typeof value.notes === 'string')
    && (value.allergyReview === undefined || isAllergyReview(value.allergyReview))
}

function isPrescription(value: unknown): value is Prescription {
  return isObject(value) && hasStrings(value, ['id', 'medication', 'strength', 'instructions', 'duration', 'notes'])
    && isDateKey(value.date)
}

function isPatientDocument(value: unknown): value is PatientDocument {
  return isObject(value) && hasStrings(value, ['id', 'filename', 'fileType', 'extractedAt', 'text'])
    && typeof value.pageCount === 'number' && Number.isInteger(value.pageCount) && value.pageCount >= 1
    && Array.isArray(value.ocrPagesUsed) && value.ocrPagesUsed.every((page) => Number.isInteger(page) && page >= 1)
}

// Older demo records used gender and inferred allergy status from the display text.
export function parseStoredPatients(value: unknown): Patient[] | null {
  if (!Array.isArray(value)) return null
  const patients: Patient[] = []
  for (const item of value) {
    if (!isObject(item) || !hasStrings(item, ['id', 'name', 'initials', 'phone', 'email', 'patientNumber', 'allergy', 'notes'])
      || !isDateKey(item.birthDate) || !isDateKey(item.joined)
      || !(item.lastVisit === 'New patient' || isDateKey(item.lastVisit))
      || !Array.isArray(item.records) || !item.records.every(isMedicalRecord)
      || !Array.isArray(item.prescriptions) || !item.prescriptions.every(isPrescription)
      || (item.documents !== undefined && (!Array.isArray(item.documents) || !item.documents.every(isPatientDocument)))) return null
    const sex = item.sex ?? item.gender ?? ''
    const allergyStatus = item.allergyStatus ?? (item.allergy === 'No known allergies' ? 'none' : item.allergy === 'Not recorded' ? 'unknown' : 'known')
    if (typeof sex !== 'string' || typeof allergyStatus !== 'string' || !['unknown', 'none', 'known'].includes(allergyStatus)) return null
    patients.push({ ...item, documents: item.documents ?? [], sex, allergyStatus } as Patient)
  }
  return patients
}

export function isStoredAppointments(value: unknown): value is Appointment[] {
  return Array.isArray(value) && value.every((item) => isObject(item)
    && hasStrings(item, ['id', 'patientId', 'reason', 'clinician']) && isDateKey(item.date)
    && typeof item.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)
    && typeof item.duration === 'number' && Number.isFinite(item.duration) && item.duration > 0
    && typeof item.status === 'string' && ['scheduled', 'confirmed', 'checked_in', 'completed', 'cancelled'].includes(item.status)
    && (item.source === undefined || item.source === 'staff' || item.source === 'online'))
}

export function isStoredDateList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => isDateKey(item))
}

export function isClosingTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

export function isQueueSession(value: unknown): value is QueueSession {
  return isObject(value) && isDateKey(value.date) && typeof value.token === 'string' && value.token.length > 0
    && typeof value.isOpen === 'boolean' && Array.isArray(value.entries)
    && (value.ended === undefined || typeof value.ended === 'boolean')
    && (value.closesAt === undefined || isClosingTime(value.closesAt))
    && value.entries.every((entry) => isObject(entry) && hasStrings(entry, ['id', 'number', 'name', 'phone', 'joinedAt'])
      && !Number.isNaN(Date.parse(entry.joinedAt as string))
      && typeof entry.status === 'string' && ['waiting', 'called', 'completed'].includes(entry.status)
      && (entry.allergyDiscrepancy === undefined || isAllergyDiscrepancy(entry.allergyDiscrepancy))
      && (entry.reportedReason === undefined || typeof entry.reportedReason === 'string')
      && (entry.reportedSymptoms === undefined || typeof entry.reportedSymptoms === 'string')
      && (entry.lane === undefined || entry.lane === 'urgent' || entry.lane === 'priority' || entry.lane === 'regular')
      && (entry.addedBy === undefined || entry.addedBy === 'Doctor' || entry.addedBy === 'Attendant'))
}

export function readStored<T>(key: string, fallback: () => T, validate: (value: unknown) => boolean): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback()
    const value: unknown = JSON.parse(raw)
    return validate(value) ? value as T : fallback()
  } catch {
    return fallback()
  }
}

export function saveStored(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}
