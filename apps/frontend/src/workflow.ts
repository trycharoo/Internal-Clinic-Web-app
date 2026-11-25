import {
  ageFromBirthDate, dateKey, hasAppointmentConflict, isDateKey,
  type AllergyDiscrepancy, type AllergyStatus, type Appointment, type MedicalRecord,
  type Patient, type Prescription, type QueueEntry, type QueueLane, type QueueSession,
} from './clinic'

// Pure clinical-workflow rules used by the browser demo. Components render these results; they hold no state of their own.

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024
const START_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export type AllergyFilter = 'all' | 'known' | 'none' | 'unrecorded'
export type ParsedDocument = { filename: string; fileType: string; pageCount: number; ocrPagesUsed: number[]; text: string }

// --- Registration (walk-in and staff) -------------------------------------------------

export type RegistrationForm = {
  name: string
  birthDate: string
  sex: string
  email: string
  allergyStatus: '' | AllergyStatus
  allergyDetails: string
}

// Returns the first message that blocks a chart from being created, or null when the form is complete and valid.
export function registrationError(form: RegistrationForm, today: Date): string | null {
  if (!form.name.trim()) return 'Enter the patient’s name to continue.'
  if (!form.birthDate) return 'Enter the patient’s date of birth.'
  if (!isDateKey(form.birthDate)) return 'Enter a valid date of birth.'
  if (form.birthDate > dateKey(today)) return 'Date of birth cannot be in the future.'
  if (!form.sex) return 'Select the patient’s sex or choose not to disclose.'
  if (!form.allergyStatus) return 'Record an allergy status before continuing.'
  if (form.allergyStatus === 'known' && !form.allergyDetails.trim()) return 'Enter the known allergy or select another allergy status.'
  if (form.email.trim() && !EMAIL_PATTERN.test(form.email.trim())) return 'Enter a valid email address or leave it blank.'
  return null
}

// The stored allergy text. "Unknown" is never rendered as "No known allergies".
export function allergyDescription(status: AllergyStatus, details: string): string {
  if (status === 'none') return 'No known allergies'
  if (status === 'unknown') return 'Not recorded'
  return details.trim()
}

// Reception must enter the allergy details before confirming a known allergy.
export function confirmedAllergyError(status: '' | AllergyStatus, details: string): string | null {
  return status === 'known' && !details.trim() ? 'Enter the confirmed allergy details.' : null
}

// --- Daily check-in (public QR preview) -----------------------------------------------

export type CheckInDetails = {
  name: string
  phone: string
  birthDate: string
  sex: string
  allergyStatus: AllergyStatus
  allergy: string
  // Optional, in the patient's own words.
  reason?: string
  symptoms?: string
}

export function checkInError(details: CheckInDetails, today: Date): string | null {
  const phone = details.phone.trim()
  const invalid = !details.name.trim()
    || !phone
    || !/\d/.test(phone)
    || ageFromBirthDate(details.birthDate, today) === null
    || !details.sex
    || (details.allergyStatus === 'known' && !details.allergy.trim())
  return invalid ? 'Enter your name, phone, valid date of birth, sex, and allergy details when known.' : null
}

export function phoneDigits(value: string): string {
  return value.replace(/\D/g, '')
}

function sameName(a: string, b: string) {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()
}

export type Identity = { name: string; phone: string; birthDate: string }

// A repeat check-in with the same identity returns the open ticket instead of issuing another number.
export function findActiveTicket(entries: QueueEntry[], identity: Identity): QueueEntry | undefined {
  return entries.find((entry) => entry.status !== 'completed'
    && sameName(entry.name, identity.name)
    && phoneDigits(entry.phone) === phoneDigits(identity.phone)
    && entry.birthDate === identity.birthDate)
}

// Returns an existing chart only when name, phone digits and date of birth all match. Shared phones are not identity.
export function findMatchingChart(patients: Patient[], identity: Identity): Patient | undefined {
  return patients.find((patient) => sameName(patient.name, identity.name)
    && phoneDigits(patient.phone) === phoneDigits(identity.phone)
    && patient.birthDate === identity.birthDate)
}

// --- Queue lanes ------------------------------------------------------------------------
// MVP rule, pending clinic validation: seniors (60 and over, the Philippine senior citizen age) and pediatric patients
// (under 18) share a priority lane. Adults 18 to 59 use the regular lane. The doctor can still choose any patient.

export const SENIOR_MIN_AGE = 60
export const PEDIATRIC_MAX_AGE = 17

export type PriorityReason = 'Senior' | 'Pediatric'

export function priorityReason(age: number | null): PriorityReason | null {
  if (age === null) return null
  if (age >= SENIOR_MIN_AGE) return 'Senior'
  return age <= PEDIATRIC_MAX_AGE ? 'Pediatric' : null
}

export function laneForAge(age: number | null): QueueLane {
  return priorityReason(age) ? 'priority' : 'regular'
}

export function entryLane(entry: Pick<QueueEntry, 'lane'>): QueueLane {
  return entry.lane ?? 'regular'
}

export function laneLabel(lane: QueueLane): string {
  if (lane === 'urgent') return 'Urgent (seen first)'
  return lane === 'priority' ? 'Priority (senior & pediatric)' : 'Regular (adult)'
}

const LANE_PREFIX: Record<QueueLane, string> = { urgent: 'U', priority: 'P', regular: 'R' }
// Lower ranks are called first.
const LANE_RANK: Record<QueueLane, number> = { urgent: 0, priority: 1, regular: 2 }

// Zero-padded ticket number with a lane prefix, counted within the lane: U-001, P-001, R-001.
export function ticketNumber(issuedInLane: number, lane: QueueLane): string {
  return `${LANE_PREFIX[lane]}-${String(issuedInLane + 1).padStart(3, '0')}`
}

export function nextTicketNumber(entries: Pick<QueueEntry, 'lane'>[], lane: QueueLane): string {
  return ticketNumber(entries.filter((entry) => entryLane(entry) === lane).length, lane)
}

export function patientNumberFor(existingPatients: number): string {
  return `PT-${String(10500 + existingPatients).padStart(5, '0')}`
}

// --- Manual queue entry (staff) ---------------------------------------------------------
// Fallback when the QR cannot be used, for example an emergency or a patient without a phone. The doctor and the
// attendant can both add a ticket at any time, including while intake is paused, ended or expired.

export type ManualQueueForm = {
  name: string
  birthDate: string
  sex: string
  phone: string
  reason: string
  urgent: boolean
}

// Returns the first message that blocks a manual ticket, or null. An urgent ticket must say why, so the doctor can see it.
export function manualQueueError(form: ManualQueueForm, today: Date): string | null {
  if (!form.name.trim()) return 'Enter the patient’s name to continue.'
  if (!form.birthDate) return 'Enter the patient’s date of birth. Use the best estimate if it is not known.'
  if (ageFromBirthDate(form.birthDate, today) === null) return 'Enter a valid date of birth that is not in the future.'
  if (!form.sex) return 'Select the patient’s sex, or Unknown.'
  if (form.urgent && !form.reason.trim()) return 'Enter why this patient is urgent.'
  return reportedTextError(form.reason, '')
}

// Urgent is chosen by staff. Otherwise the lane follows the date of birth, as it does for QR check-in.
export function manualQueueLane(urgent: boolean, age: number | null): QueueLane {
  return urgent ? 'urgent' : laneForAge(age)
}

// --- Intake session (daily QR) ----------------------------------------------------------

// open: accepting check-ins. paused: staff paused it. closed: the doctor ended today's intake. expired: the closing time has passed.
export type IntakeStatus = 'open' | 'paused' | 'closed' | 'expired'

export function intakeStatus(session: Pick<QueueSession, 'isOpen' | 'ended' | 'closesAt'>, now: Date): IntakeStatus {
  if (session.ended) return 'closed'
  if (session.closesAt && minutesOfDay(now) >= minutesOf(session.closesAt)) return 'expired'
  return session.isOpen ? 'open' : 'paused'
}

export function minutesOfDay(now: Date): number {
  return now.getHours() * 60 + now.getMinutes()
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

// Closing times the doctor can choose: every half hour from 08:00 to 20:00 on the clinic day.
export function closingTimeOptions(): string[] {
  return Array.from({ length: 25 }, (_, index) => {
    const minutes = 8 * 60 + index * 30
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  })
}

export const REASON_MAX_LENGTH = 160
export const SYMPTOMS_MAX_LENGTH = 500

// What the patient typed, trimmed. Blank text is recorded as nothing rather than as an empty string.
export function reportedText(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed || undefined
}

export function reportedTextError(reason: string, symptoms: string): string | null {
  if (reason.trim().length > REASON_MAX_LENGTH) return `Keep the reason for your visit under ${REASON_MAX_LENGTH} characters.`
  if (symptoms.trim().length > SYMPTOMS_MAX_LENGTH) return `Keep the description of how you feel under ${SYMPTOMS_MAX_LENGTH} characters.`
  return null
}

// --- Daily queue ------------------------------------------------------------------------

// Waiting for the doctor to choose them: not yet in consultation, and ready (or an older ticket with no stage).
function canBeNext(entry: QueueEntry): boolean {
  return entry.status === 'waiting' && (!entry.stage || entry.stage === 'ready' || entry.stage === 'triage')
}

// Urgent first, then the priority lane, then regular; arrival order within a lane. Equal arrival times keep their stored order.
export function waitingOrder(entries: QueueEntry[]): QueueEntry[] {
  return entries.filter(canBeNext)
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => LANE_RANK[entryLane(a.entry)] - LANE_RANK[entryLane(b.entry)]
      || Date.parse(a.entry.joinedAt) - Date.parse(b.entry.joinedAt) || a.index - b.index)
    .map(({ entry }) => entry)
}

// The ticket being seen or called now. The clinic has one doctor, so there is one current number.
export function nowServing(entries: QueueEntry[]): QueueEntry | undefined {
  return entries.find((entry) => entry.stage === 'consulting') ?? entries.find((entry) => entry.status === 'called')
}

// How many waiting patients the doctor would reach before this one by default. Null when the patient is not waiting.
export function peopleAhead(entries: QueueEntry[], entryId: string): number | null {
  const position = waitingOrder(entries).findIndex((entry) => entry.id === entryId)
  return position === -1 ? null : position
}

// The sentence shown to a patient about their own ticket.
export function ticketStanding(entries: QueueEntry[], ticket: QueueEntry): string {
  if (nowServing(entries)?.id === ticket.id) return 'It’s your turn. Please go to the doctor.'
  if (ticket.stage === 'complete' || ticket.status === 'completed') return 'Your visit is complete.'
  const ahead = peopleAhead(entries, ticket.id)
  if (ahead === null) return 'Please wait. The clinic will call you.'
  if (ahead === 0) return 'You are next.'
  return `${ahead} ${ahead === 1 ? 'person is' : 'people are'} ahead of you.`
}

// The doctor's list: the patient in the room first, then everyone waiting in call order, then finished tickets.
export function queueDisplayOrder(entries: QueueEntry[]): QueueEntry[] {
  const waiting = waitingOrder(entries)
  const inProgress = entries.filter((entry) => !waiting.includes(entry) && entry.status !== 'completed' && entry.stage !== 'complete')
  const finished = entries.filter((entry) => !waiting.includes(entry) && !inProgress.includes(entry))
  return [...inProgress, ...waiting, ...finished]
}

export function queueSnapshot(entries: QueueEntry[]) {
  const waiting = entries.filter((entry) => entry.status === 'waiting' && entry.stage !== 'consulting')
  return {
    waiting,
    called: entries.find((entry) => entry.status === 'called' || entry.stage === 'consulting'),
    consulting: entries.find((entry) => entry.stage === 'consulting'),
    completedCount: entries.filter((entry) => entry.status === 'completed').length,
    nextWaiting: waitingOrder(entries)[0],
  }
}

// Triage is optional. Attendants may still record vitals, once, before the doctor starts the consultation.
export function canRecordTriage(entry: QueueEntry): boolean {
  return entry.status !== 'completed' && !entry.triage && (entry.stage === 'triage' || entry.stage === 'ready')
}

// Waiting for the doctor to pick them. Triage does not gate this.
export function isAwaitingDoctor(entry: QueueEntry): boolean {
  return entry.status !== 'completed' && (entry.stage === 'triage' || entry.stage === 'ready')
}

export function queueStatusLabel(entry: QueueEntry): string {
  // 'triage' is the stage older saved check-ins may still carry; they are now treated as ready for the doctor.
  if (entry.stage === 'triage' || entry.stage === 'ready') return 'Ready for doctor'
  if (entry.stage === 'consulting') return 'In consultation'
  if (entry.stage === 'complete') return 'Visit complete'
  if (entry.status === 'waiting') return 'Waiting'
  if (entry.status === 'called') return 'Called'
  return 'Ticket marked seen'
}

export type QueueRowAction = 'start-consultation' | 'in-consultation' | 'view-history' | 'mark-seen' | 'call-ticket' | 'seen'

// Which action a queue row offers. The doctor may start any waiting patient; triage is optional. Only one consultation runs at a time.
export function queueRowAction(entry: QueueEntry, state: { consultationInProgress: boolean; ticketCalled: boolean }): { action: QueueRowAction; disabled: boolean } {
  if (entry.stage === 'triage' || entry.stage === 'ready') return { action: 'start-consultation', disabled: state.consultationInProgress }
  if (entry.stage === 'consulting') return { action: 'in-consultation', disabled: false }
  if (entry.stage === 'complete' && entry.patientId) return { action: 'view-history', disabled: false }
  if (entry.status === 'called') return { action: 'mark-seen', disabled: false }
  if (entry.status === 'waiting') return { action: 'call-ticket', disabled: state.ticketCalled }
  return { action: 'seen', disabled: false }
}

// --- Allergy reconciliation -------------------------------------------------------------
// Industry practice: a documented allergy is never removed or downgraded by intake or triage. Staff may add or
// confirm allergies; a clinician decides whether a documented allergy is wrong and records why.

export type ChartAllergy = { allergyStatus: AllergyStatus; allergy: string }
export type AllergyReconciliation = { chart: ChartAllergy | null; discrepancy: AllergyDiscrepancy | null }

// Splits a free-text list such as "Penicillin, latex" into trimmed names, dropping repeats regardless of case.
export function allergyNames(text: string): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const part of text.split(/[,;]/)) {
    const name = part.trim()
    const key = name.toLocaleLowerCase()
    if (name && !seen.has(key)) {
      seen.add(key)
      names.push(name)
    }
  }
  return names
}

export function mergeAllergies(documented: string, confirmed: string): string {
  return allergyNames(`${documented}, ${confirmed}`).join(', ')
}

// Returns the chart change triage may make (null when the chart stays as documented) and any conflict for the doctor.
export function reconcileAllergy(chart: ChartAllergy, confirmed: { status: AllergyStatus; details: string }): AllergyReconciliation {
  if (confirmed.status === 'known') {
    const allergy = chart.allergyStatus === 'known' ? mergeAllergies(chart.allergy, confirmed.details) : confirmed.details.trim()
    return { chart: { allergyStatus: 'known', allergy }, discrepancy: null }
  }
  if (chart.allergyStatus === 'known') {
    return { chart: null, discrepancy: { reportedStatus: confirmed.status, documentedAllergy: chart.allergy } }
  }
  if (confirmed.status === 'none' && chart.allergyStatus === 'unknown') {
    return { chart: { allergyStatus: 'none', allergy: allergyDescription('none', '') }, discrepancy: null }
  }
  // A confirmed "none" is never downgraded to "unknown" at triage.
  return { chart: null, discrepancy: null }
}

export function allergyReviewError(decision: '' | 'kept' | 'removed', reason: string): string | null {
  if (!decision) return 'Choose whether to keep or remove the documented allergy.'
  if (decision === 'removed' && !reason.trim()) return 'Enter the reason for removing a documented allergy.'
  return null
}

// Allergies are confirmed at the start of the consultation unless an attendant already confirmed them at triage.
export function allergyConfirmationError(status: '' | AllergyStatus, details: string): string | null {
  if (!status) return 'Confirm the patient’s allergy status with the patient.'
  return confirmedAllergyError(status, details)
}

// What saving a visit does to the chart's allergies. A conflict already raised at triage is passed through unchanged.
// Otherwise the doctor's confirmation is reconciled with the chart, so a documented allergy still needs an explicit decision.
export function visitAllergyOutcome(
  chart: ChartAllergy,
  raisedAtTriage: AllergyDiscrepancy | undefined,
  confirmed: { status: AllergyStatus; details: string } | undefined,
): AllergyReconciliation {
  if (raisedAtTriage) return { chart: null, discrepancy: raisedAtTriage }
  if (!confirmed) return { chart: null, discrepancy: null }
  return reconcileAllergy(chart, confirmed)
}

// The chart after the doctor's decision. Keeping changes nothing; removing records "no known allergies".
export function allergyAfterReview(decision: 'kept' | 'removed'): ChartAllergy | null {
  return decision === 'removed' ? { allergyStatus: 'none', allergy: allergyDescription('none', '') } : null
}

// --- Visit documentation and prescriptions ---------------------------------------------

export type VisitValues = {
  signs: string
  symptoms: string
  diagnosis: string
  notes: string
  medication: string
  strength: string
  instructions: string
  duration: string
}

// A visit can be saved only when some clinical content exists, including the live-saved interview note.
export function hasEncounterContent(values: { signs: string; symptoms: string; diagnosis: string; liveNotes: string }): boolean {
  return [values.signs, values.symptoms, values.diagnosis, values.liveNotes].some((value) => value.trim() !== '')
}

// Builds the encounter note. The live interview draft is appended to the visit notes, so it is preserved in history.
export function encounterRecord(values: VisitValues, options: { date: string; encounterId: string; liveNotes: string; triage?: QueueEntry['triage'] }): Omit<MedicalRecord, 'id'> {
  return {
    date: options.date,
    signs: values.signs.trim(),
    symptoms: values.symptoms.trim(),
    diagnosis: values.diagnosis.trim(),
    notes: [options.liveNotes.trim(), values.notes.trim()].filter(Boolean).join('\n\n'),
    encounterId: options.encounterId,
    triage: options.triage,
  }
}

// A prescription is optional. Without a medication name no prescription is created.
export function encounterPrescription(values: VisitValues, options: { date: string; encounterId: string }): Omit<Prescription, 'id'> | null {
  const medication = values.medication.trim()
  if (!medication) return null
  return {
    date: options.date,
    medication,
    strength: values.strength.trim(),
    instructions: values.instructions.trim(),
    duration: values.duration.trim(),
    notes: '',
    encounterId: options.encounterId,
  }
}

export function reviewedTextError(text: string): string | null {
  return text.trim() ? null : 'Review the extracted text before saving. The text cannot be empty.'
}

// --- Appointments -----------------------------------------------------------------------

// Half-hour start times offered by the booking form, 08:00 to 17:30.
export function appointmentStartTimes(): string[] {
  return Array.from({ length: 20 }, (_, index) => {
    const minutes = 8 * 60 + index * 30
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  })
}

// Returns why a booking cannot be saved, or null. Overlap uses the half-open interval rule from the shared scheduling helper.
export function bookingError(candidate: Pick<Appointment, 'patientId' | 'date' | 'time' | 'duration'>, appointments: Appointment[]): string | null {
  if (!candidate.patientId) return 'Select a patient before booking.'
  if (!isDateKey(candidate.date)) return 'Choose a valid appointment date.'
  if (!START_TIME_PATTERN.test(candidate.time)) return 'Choose a valid start time.'
  if (!Number.isFinite(candidate.duration) || candidate.duration <= 0) return 'Choose a visit length.'
  if (hasAppointmentConflict(candidate, appointments)) return 'That time overlaps an existing appointment. Choose another slot.'
  return null
}

// Work-week (Monday to Friday) or single-day columns containing the anchor date.
export function visibleDays(anchorDate: string, view: 'week' | 'day'): Date[] {
  const anchor = new Date(`${anchorDate}T12:00:00`)
  if (view === 'day') return [anchor]
  const monday = new Date(anchor)
  const weekday = (anchor.getDay() + 6) % 7
  monday.setDate(anchor.getDate() - weekday)
  return Array.from({ length: 5 }, (_, index) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + index)
    return date
  })
}

// --- Patient directory and search -------------------------------------------------------

export function filterPatients(patients: Patient[], query: string, allergyFilter: AllergyFilter): Patient[] {
  const needle = query.trim().toLowerCase()
  return patients.filter((patient) => {
    const matchesQuery = `${patient.name} ${patient.patientNumber} ${patient.phone} ${patient.email}`.toLowerCase().includes(needle)
    const matchesAllergy = allergyFilter === 'all'
      || (allergyFilter === 'known' && patient.allergyStatus === 'known')
      || (allergyFilter === 'none' && patient.allergyStatus === 'none')
      || (allergyFilter === 'unrecorded' && patient.allergyStatus === 'unknown')
    return matchesQuery && matchesAllergy
  })
}

// Global header search: needs at least two characters and returns at most `limit` matches.
export function searchPatients(patients: Patient[], query: string, limit = 5): Patient[] {
  const needle = query.trim().toLowerCase()
  if (needle.length <= 1) return []
  return patients
    .filter((patient) => `${patient.name} ${patient.patientNumber} ${patient.phone}`.toLowerCase().includes(needle))
    .slice(0, limit)
}

// --- Document parsing -------------------------------------------------------------------

export function documentSizeError(bytes: number): string | null {
  return bytes > MAX_DOCUMENT_BYTES ? 'File exceeds 25MB limit.' : null
}

export function parserErrorMessage(result: unknown): string {
  return typeof result === 'object' && result !== null && 'detail' in result && typeof result.detail === 'string'
    ? result.detail
    : 'Unable to parse document.'
}

// Validates the parser response shape before any text is shown for review. Returns null for anything unexpected.
export function parsedDocument(result: unknown): ParsedDocument | null {
  if (typeof result !== 'object' || result === null) return null
  if (!('filename' in result) || typeof result.filename !== 'string') return null
  if (!('file_type' in result) || typeof result.file_type !== 'string') return null
  if (!('page_count' in result) || typeof result.page_count !== 'number') return null
  if (!('ocr_pages_used' in result) || !Array.isArray(result.ocr_pages_used)) return null
  if (!result.ocr_pages_used.every((page) => Number.isInteger(page))) return null
  if (!('text' in result) || typeof result.text !== 'string') return null
  return {
    filename: result.filename,
    fileType: result.file_type,
    pageCount: result.page_count,
    ocrPagesUsed: result.ocr_pages_used as number[],
    text: result.text,
  }
}

// --- Clock formatting -----------------------------------------------------------------------

// 24-hour clinic time (HH:MM) as shown to people, for example 9:05 AM.
export function formatTime(value: string): string {
  const [hours, minutes] = value.split(':').map(Number)
  const suffix = hours >= 12 ? 'PM' : 'AM'
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${suffix}`
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

// --- Online booking by patients ---------------------------------------------------------------
// The doctor opens online booking for a day. Patients can see whether each slot is free, but never who holds a slot.

export const ONLINE_BOOKING_DAYS = 60
export const ONLINE_VISIT_MINUTES = 30

export type SlotStatus = 'open' | 'booked' | 'passed' | 'not-accepting'
export type DaySlot = { time: string; status: SlotStatus }

export function dayAvailability(date: string, appointments: Appointment[], options: { accepting: boolean; now: Date }): DaySlot[] {
  const today = dateKey(options.now)
  const nowMinutes = minutesOfDay(options.now)
  return appointmentStartTimes().map((time) => {
    const started = date < today || (date === today && minutesOf(time) <= nowMinutes)
    if (started) return { time, status: 'passed' }
    if (hasAppointmentConflict({ date, time, duration: ONLINE_VISIT_MINUTES }, appointments)) return { time, status: 'booked' }
    return { time, status: options.accepting ? 'open' : 'not-accepting' }
  })
}

// Why a patient cannot book this time, or null when the booking can be saved.
export function onlineBookingError(
  candidate: { patientId: string; date: string; time: string; reason: string },
  state: { appointments: Appointment[]; acceptingDates: string[]; now: Date },
): string | null {
  const today = dateKey(state.now)
  if (!candidate.patientId) return 'Sign in to book an online appointment.'
  if (!isDateKey(candidate.date)) return 'Choose a valid date.'
  if (candidate.date < today) return 'Choose today or a later date.'
  if (candidate.date > dateKey(addDays(state.now, ONLINE_BOOKING_DAYS))) return `Online booking opens up to ${ONLINE_BOOKING_DAYS} days ahead.`
  if (!state.acceptingDates.includes(candidate.date)) return 'Dr. Reyes is not accepting online bookings on that date. Please call the clinic or ask reception.'
  if (!appointmentStartTimes().includes(candidate.time)) return 'Choose a time from the list.'
  if (candidate.date === today && minutesOf(candidate.time) <= minutesOfDay(state.now)) return 'That time has already passed. Choose a later time.'
  const reasonError = reportedTextError(candidate.reason, '')
  if (reasonError) return reasonError
  if (state.appointments.some((item) => item.patientId === candidate.patientId && item.date === candidate.date && item.status !== 'cancelled')) {
    return 'You already have an appointment on this day.'
  }
  return bookingError({ patientId: candidate.patientId, date: candidate.date, time: candidate.time, duration: ONLINE_VISIT_MINUTES }, state.appointments)
}

// Adds or removes a day the doctor accepts online bookings for, keeping the list sorted and free of repeats.
export function toggleOnlineDate(dates: string[], date: string): string[] {
  const next = dates.includes(date) ? dates.filter((item) => item !== date) : [...dates, date]
  return [...new Set(next)].sort()
}
