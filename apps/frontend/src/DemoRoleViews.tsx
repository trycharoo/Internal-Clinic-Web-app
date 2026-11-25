import { Activity, ArrowRight, CalendarDays, CheckCircle2, ClipboardList, Clock3, HeartHandshake, LogOut, Plus, QrCode, UserRound, UserRoundPlus, Users } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { dateKey, type Appointment, type Patient, type QueueSession } from './clinic'
import { addDays, canRecordTriage, dayAvailability, formatTime, isAwaitingDoctor, ONLINE_BOOKING_DAYS, REASON_MAX_LENGTH, type IntakeStatus, type SlotStatus } from './workflow'
import './patient-booking.css'
import './demo-role-views.css'

function DemoHeader({ role, onSignOut }: { role: string; onSignOut: () => void }) {
  return <header className="role-demo-header">
    <div className="role-demo-brand"><span><Activity size={22} strokeWidth={1.8} /></span><div><strong>northstar</strong><small>CLINIC WORKSPACE</small></div></div>
    <div className="role-demo-header-actions"><span className="role-demo-role-badge">{role} · Demo</span><button type="button" className="role-demo-button role-demo-button-secondary" onClick={onSignOut}><LogOut size={16} />Log in as</button></div>
  </header>
}

function DemoFooter() {
  return <footer className="role-demo-footer"><span>Northstar Clinic · Synthetic demo data</span><span>Preview only · Data stays in this browser</span></footer>
}

export function PatientDemoPage({ onSignOut, onCheckIn, queueAvailable, queueSummary, patientId, appointments, acceptingDates, onBookOnline }: {
  onSignOut: () => void
  onCheckIn: () => void
  queueAvailable: boolean
  // Today's line as any patient may see it: the current number and how many are waiting. No names.
  queueSummary: { serving: string | null; waiting: number } | null
  patientId: string
  appointments: Appointment[]
  acceptingDates: string[]
  onBookOnline: (values: { date: string; time: string; reason: string }) => { error: string; reference?: string }
}) {
  return <div className="role-demo-shell">
    <DemoHeader role="Patient" onSignOut={onSignOut} />
    <main className="role-demo-content role-demo-patient-content">
      <section className="role-demo-patient-welcome">
        <div className="role-demo-kicker">YOUR NORTHSTAR VISIT</div>
        <div className="role-demo-welcome-icon"><HeartHandshake size={28} strokeWidth={1.5} /></div>
        <h1>Welcome, Sofia.</h1>
        <p>A little less waiting.<br />A little more peace of mind.</p>
        <div className="role-demo-patient-identity"><span>SR</span><div><strong>Sofia Reyes</strong><small>Sample patient account</small></div></div>
      </section>

      <section className="role-demo-checkin-card" aria-labelledby="patient-demo-checkin-heading">
        <div className="role-demo-card-icon"><QrCode size={24} strokeWidth={1.7} /></div>
        <div className="role-demo-kicker">BEFORE YOUR CONSULTATION</div>
        <h2 id="patient-demo-checkin-heading">Start with a warm welcome.</h2>
        <p>Complete today’s registration, then let reception know you have arrived. The clinic team will help you with the next step.</p>
        <div className={`role-demo-intake-status ${queueAvailable ? 'is-open' : ''}`}><span />{queueAvailable ? 'Today’s check-in is open' : 'Patient check-in is not open'}</div>
        {queueSummary && <p className="role-demo-queue-summary" aria-label="Today’s queue">Now serving: <strong>{queueSummary.serving ?? 'No one yet'}</strong> · {queueSummary.waiting} waiting. Seniors and pediatric patients are seen first.</p>}
        {!queueAvailable && <p className="role-demo-checkin-guidance">The doctor opens each day’s intake. Please ask reception when check-in becomes available.</p>}
        <button type="button" className="role-demo-button role-demo-button-primary role-demo-checkin-button" disabled={!queueAvailable} onClick={onCheckIn}>Open patient check-in<ArrowRight size={17} /></button>
        <p className="role-demo-small-note">Use synthetic details in this demo. Check-in works in this browser only.</p>
      </section>

      <PatientBookingCard patientId={patientId} appointments={appointments} acceptingDates={acceptingDates} onBookOnline={onBookOnline} />

      <section className="role-demo-visit-guide" aria-labelledby="patient-demo-guide-heading">
        <h2 id="patient-demo-guide-heading">A simple path to your visit</h2>
        <ol><li><span>01</span><div><strong>Share your details</strong><p>Complete the registration form for today’s visit.</p></div></li><li><span>02</span><div><strong>Meet reception</strong><p>The clinic team confirms your details and arrival.</p></div></li><li><span>03</span><div><strong>Get ready for care</strong><p>The team will guide you through preparation and your consultation.</p></div></li></ol>
      </section>
    </main>
    <DemoFooter />
  </div>
}

function longDate(value: string) {
  return new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${value}T12:00:00`))
}

const slotLabels: Record<SlotStatus, string> = { open: 'Open', booked: 'Booked', passed: 'Passed', 'not-accepting': 'Not open online' }

// Patients see whether each time is free on a chosen day. Other patients' names and details never appear here.
function PatientBookingCard({ patientId, appointments, acceptingDates, onBookOnline }: {
  patientId: string
  appointments: Appointment[]
  acceptingDates: string[]
  onBookOnline: (values: { date: string; time: string; reason: string }) => { error: string; reference?: string }
}) {
  const now = new Date()
  const today = dateKey(now)
  const [date, setDate] = useState(today)
  const [selectedTime, setSelectedTime] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const accepting = acceptingDates.includes(date)
  const slots = dayAvailability(date, appointments, { accepting, now })
  const upcoming = appointments
    .filter((item) => item.patientId === patientId && item.status !== 'cancelled' && item.date >= today)
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))

  function chooseDate(next: string) {
    setDate(next)
    setSelectedTime('')
    setError('')
    setConfirmation('')
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const result = onBookOnline({ date, time: selectedTime, reason })
    if (result.error) {
      setError(result.error)
      return
    }
    setConfirmation(`Booked for ${longDate(date)} at ${formatTime(selectedTime)}. Reference ${result.reference}. Please confirm your arrival at reception.`)
    setSelectedTime('')
    setReason('')
    setError('')
  }

  return <section className="role-demo-surface patient-booking-card" aria-label="Book online">
    <div className="role-demo-section-heading"><div><div className="role-demo-kicker">BOOK ONLINE</div><h2>Choose a time that suits you</h2><p>Booked times show as booked. Other patients’ details are never shown.</p></div></div>
    <label className="patient-booking-date"><span>Date</span><input type="date" min={today} max={dateKey(addDays(now, ONLINE_BOOKING_DAYS))} value={date} onChange={(event) => chooseDate(event.target.value)} /></label>
    <p className="patient-booking-status">{accepting ? 'Dr. Reyes is accepting online bookings on this day.' : 'Dr. Reyes is not accepting online bookings on this day. Booked times are shown so you can plan around them.'}</p>
    <div className="patient-slot-grid" role="group" aria-label="Times on this day">
      {slots.map((slot) => <button key={slot.time} type="button" className={`patient-slot patient-slot-${slot.status}`} disabled={slot.status !== 'open'} aria-pressed={selectedTime === slot.time} onClick={() => { setSelectedTime(slot.time); setError(''); setConfirmation('') }}>{formatTime(slot.time)} · {slotLabels[slot.status]}</button>)}
    </div>
    {selectedTime && <form className="patient-booking-form" onSubmit={submit}>
      <label><span>Reason for visit (optional)</span><input maxLength={REASON_MAX_LENGTH} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="For example: follow-up on my blood pressure" /></label>
      <button className="role-demo-button role-demo-button-primary" type="submit">Confirm booking</button>
    </form>}
    {error && <p className="role-demo-form-error" role="alert">{error}</p>}
    {confirmation && <p className="role-demo-confirmation" role="status">{confirmation}</p>}
    <h3>Your upcoming appointments</h3>
    {upcoming.length ? <ul className="patient-upcoming">{upcoming.map((item) => <li key={item.id}><strong>{longDate(item.date)}</strong><span>{formatTime(item.time)} · {item.reason}</span></li>)}</ul> : <p className="role-demo-small-note">You have no upcoming appointments.</p>}
  </section>
}

const appointmentLabels: Record<Appointment['status'], string> = { scheduled: 'Scheduled', confirmed: 'Confirmed', checked_in: 'Checked in', completed: 'Completed', cancelled: 'Cancelled' }

function receptionIntakeLabel(intake: IntakeStatus | null, session: QueueSession | null): string {
  if (intake === 'open') return 'Check-in open'
  if (intake === 'paused') return 'Check-in paused'
  if (intake === 'closed') return 'Intake ended'
  return `Closed at ${session?.closesAt ?? ''}`
}

export function ReceptionDemoPage({ patients, appointments, session, intake, onSignOut, onRegister, onSchedule, onAddToQueue, onTriage, onToggleQueue }: {
  patients: Patient[]
  appointments: Appointment[]
  session: QueueSession | null
  intake: IntakeStatus | null
  onSignOut: () => void
  onRegister: () => void
  onSchedule: () => void
  // Fallback to the QR for emergencies and patients who cannot use it. Always available while signed in.
  onAddToQueue: () => void
  onTriage: (entryId: string) => void
  onToggleQueue: () => void
}) {
  const today = dateKey(new Date())
  const currentSession = session?.date === today ? session : null
  const entries = currentSession?.entries ?? []
  const todayAppointments = appointments.filter((appointment) => appointment.date === today && appointment.status !== 'cancelled').sort((a, b) => a.time.localeCompare(b.time))
  const todayPatientIds = new Set([...todayAppointments.map((appointment) => appointment.patientId), ...entries.map((entry) => entry.patientId)])
  const todayPatients = patients.filter((patient) => patient.joined === today || todayPatientIds.has(patient.id))
  const patientById = new Map(patients.map((patient) => [patient.id, patient]))
  const awaitingDoctor = entries.filter((entry) => isAwaitingDoctor(entry) && entry.patientId && patientById.has(entry.patientId))

  return <div className="role-demo-shell">
    <DemoHeader role="Attendant / Secretary" onSignOut={onSignOut} />
    <main className="role-demo-content">
      <div className="role-demo-reception-heading"><div><div className="role-demo-kicker">A THOUGHTFUL START TO EVERY VISIT</div><h1>Reception workspace</h1><p>Welcome patients, prepare their visit, and keep the clinic day moving.</p></div><div className="role-demo-heading-actions"><button type="button" className="role-demo-button role-demo-button-secondary" onClick={onSchedule}><CalendarDays size={17} />Book appointment</button><button type="button" className="role-demo-button role-demo-button-secondary" onClick={onAddToQueue}><ClipboardList size={17} />Add to queue</button><button type="button" className="role-demo-button role-demo-button-primary" onClick={onRegister}><UserRoundPlus size={17} />New walk-in</button></div></div>

      <p className="role-demo-preview-note"><CheckCircle2 size={16} />This is a role-specific demo with synthetic records. Account authentication and server permissions are not connected.</p>

      <div className="role-demo-stats"><div><span><CalendarDays size={20} /></span><div><strong>{todayAppointments.length}</strong><small>Bookings today</small></div></div><div><span><ClipboardList size={20} /></span><div><strong>{awaitingDoctor.length}</strong><small>Waiting for the doctor</small></div></div><div><span><Users size={20} /></span><div><strong>{todayPatients.length}</strong><small>Patients on today’s list</small></div></div></div>

      <div className="role-demo-reception-grid">
        <section className="role-demo-surface role-demo-queue" aria-labelledby="reception-demo-queue-heading">
          <div className="role-demo-section-heading"><div><div className="role-demo-kicker">ARRIVAL & HANDOFF</div><h2 id="reception-demo-queue-heading">Today’s reception queue</h2></div>{currentSession && <span className={`role-demo-intake-status ${intake === 'open' ? 'is-open' : ''}`}><span />{receptionIntakeLabel(intake, currentSession)}</span>}</div>
          {currentSession && <div className="role-demo-queue-toolbar"><p>Confirm the patient’s identity. Recording vitals is optional; the doctor chooses who is seen next.</p>{intake === 'open' || intake === 'paused'
            ? <button type="button" className="role-demo-button role-demo-button-secondary" onClick={onToggleQueue}>{currentSession.isOpen ? 'Pause check-in' : 'Resume check-in'}</button>
            : <p className="role-demo-small-note">{intake === 'expired' ? `Check-in closed at ${currentSession.closesAt ?? ''}. Only the doctor can change the closing time.` : 'Intake is closed for today. Only the doctor can reopen it.'}</p>}</div>}
          {entries.length > 0 ? <ul className="role-demo-queue-list">{entries.map((entry) => {
            const patient = entry.patientId ? patientById.get(entry.patientId) : undefined
            const stageLabel = entry.stage === 'complete' ? 'Visit complete' : entry.stage === 'consulting' ? 'With doctor' : entry.stage === 'ready' || entry.stage === 'triage' ? 'Waiting for doctor' : entry.status === 'completed' ? 'Ticket closed' : entry.status === 'called' ? 'Called' : 'Waiting at reception'
            const canTriage = Boolean(patient && canRecordTriage(entry))
            return <li key={entry.id}><span className="role-demo-queue-number">{entry.number}</span><div className="role-demo-queue-person"><strong>{entry.name}</strong><span>{patient?.patientNumber ?? 'Patient link not available'}{entry.phone ? ` · ${entry.phone}` : ''}</span><small>{stageLabel}</small></div>{canTriage ? <button type="button" className="role-demo-button role-demo-button-soft" onClick={() => onTriage(entry.id)}><ClipboardList size={15} />Record triage</button> : <span className="role-demo-queue-stage"><CheckCircle2 size={15} />{stageLabel}</span>}</li>
          })}</ul> : <div className="role-demo-empty"><QrCode size={29} strokeWidth={1.5} /><h3>{currentSession ? 'Ready for the first arrival' : 'Today’s intake has not opened'}</h3><p>{currentSession ? 'Patient check-ins appear here and go straight to the doctor. Recording triage is optional.' : 'The doctor opens intake and prepares today’s QR. You can still help patients register at reception.'}</p></div>}
        </section>

        <section className="role-demo-surface role-demo-appointments" aria-labelledby="reception-demo-appointments-heading">
          <div className="role-demo-section-heading"><div><div className="role-demo-kicker">THE CLINIC DAY</div><h2 id="reception-demo-appointments-heading">Today’s appointments</h2></div><Clock3 size={19} /></div>
          {todayAppointments.length > 0 ? <ul className="role-demo-appointment-list">{todayAppointments.map((appointment) => {
            const patient = patientById.get(appointment.patientId)
            return <li key={appointment.id}><time>{appointment.time}</time><div><strong>{patient?.name ?? 'Patient not available'}</strong><span>{appointment.reason || 'Clinic appointment'}</span><small>{appointmentLabels[appointment.status]}</small></div></li>
          })}</ul> : <div className="role-demo-empty"><CalendarDays size={27} strokeWidth={1.5} /><h3>No bookings today</h3><p>Book an appointment to help plan the clinic day.</p><button type="button" className="role-demo-inline-action" onClick={onSchedule}><Plus size={14} />Book an appointment</button></div>}
        </section>
      </div>

      <section className="role-demo-surface role-demo-demographics" aria-labelledby="reception-demo-patients-heading">
        <div className="role-demo-section-heading"><div><div className="role-demo-kicker">REGISTRATION DETAILS</div><h2 id="reception-demo-patients-heading">Today’s patient details</h2><p>Demographics for today’s appointments, arrivals, and new registrations.</p></div><UserRound size={20} /></div>
        {todayPatients.length > 0 ? <ul className="role-demo-demographic-list">{todayPatients.map((patient) => <li key={patient.id}><span className="role-demo-person-avatar">{patient.initials}</span><div><strong>{patient.name}</strong><span>{patient.patientNumber}</span></div><div><small>Date of birth</small><span>{patient.birthDate || 'Not recorded'}</span></div><div><small>Sex</small><span>{patient.sex || 'Not recorded'}</span></div><div><small>Contact number</small><span>{patient.phone || 'Not recorded'}</span></div></li>)}</ul> : <div className="role-demo-empty role-demo-empty-compact"><Users size={27} strokeWidth={1.5} /><h3>No patients on today’s list yet</h3><p>New registrations and linked arrivals will appear here.</p></div>}
      </section>
    </main>
    <DemoFooter />
  </div>
}
