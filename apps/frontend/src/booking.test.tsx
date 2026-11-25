import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { dateKey } from './clinic'
import { appointment, patient, storageKeys } from './test/fixtures'
import { createUser, openChart, renderDemo, savedAppointments, secondPatient, seedBaseStorage, signIntoDemo } from './test/helpers'

beforeEach(() => {
  seedBaseStorage()
})

describe('staff appointment booking and calendar navigation', () => {
  it('defaults booking from a chart to that patient and rejects invalid dates without altering existing bookings', async () => {
    localStorage.setItem(storageKeys.appointments, JSON.stringify([appointment({ id: 'appointment-keep', time: '11:00' })]))
    const user = createUser()
    renderDemo()
    await openChart(user, 'Bea Cruz')
    await user.click(screen.getByRole('button', { name: 'Schedule' }))
    expect(screen.getByRole('combobox', { name: /^Patient/ })).toHaveValue('patient-b')

    const dialog = screen.getByRole('dialog', { name: 'Book an appointment' })
    fireEvent.change(within(dialog).getByLabelText(/^Date/), { target: { value: '' } })
    fireEvent.submit(dialog.querySelector('form')!)
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a valid appointment date.')
    expect(savedAppointments().map((item) => item.id)).toEqual(['appointment-keep'])

    fireEvent.change(within(dialog).getByLabelText(/^Date/), { target: { value: dateKey(new Date()) } })
    await user.selectOptions(within(dialog).getByLabelText(/^Start time/), '12:00')
    await user.click(screen.getByRole('button', { name: 'Confirm appointment' }))
    expect(savedAppointments()[1]).toMatchObject({ patientId: 'patient-b', time: '12:00', reason: 'Office visit', status: 'scheduled' })
  })

  it('keeps an overlapping booking open for Doctor and Attendant and saves an adjacent slot after correction', async () => {
    localStorage.setItem(storageKeys.appointments, JSON.stringify([appointment({ id: 'original-booking', time: '11:00', duration: 45, reason: 'Original synthetic follow-up' })]))
    const user = createUser()
    const view = renderDemo()
    await user.click(screen.getByRole('button', { name: 'Schedule appointment' }))
    await user.click(screen.getByRole('button', { name: 'Confirm appointment' }))
    expect(screen.getByRole('alert')).toHaveTextContent('That time overlaps an existing appointment')
    expect(savedAppointments()).toHaveLength(1)
    await user.selectOptions(screen.getByRole('combobox', { name: /Start time/ }), '12:00')
    await user.click(screen.getByRole('button', { name: 'Confirm appointment' }))
    expect(savedAppointments()).toHaveLength(2)
    view.unmount()

    render(<App />)
    await signIntoDemo(user, 'Attendant')
    await user.click(screen.getByRole('button', { name: 'Book appointment' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Book an appointment' }))
    await user.selectOptions(dialog.getByRole('combobox', { name: /^Patient/ }), 'patient-b')
    await user.type(dialog.getByRole('textbox', { name: 'Visit type' }), 'Synthetic reception booking')
    await user.click(dialog.getByRole('button', { name: 'Confirm appointment' }))
    expect(dialog.getByRole('alert')).toHaveTextContent('That time overlaps an existing appointment')
    await user.selectOptions(dialog.getByRole('combobox', { name: /^Start time/ }), '13:00')
    await user.click(dialog.getByRole('button', { name: 'Confirm appointment' }))
    expect(within(screen.getByRole('region', { name: 'Today’s appointments' })).getByText('Synthetic reception booking')).toBeVisible()
    expect(savedAppointments()).toHaveLength(3)
  })

  it('navigates between week and day calendar views and across dates', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 9, 9, 0, 0))
    localStorage.setItem(storageKeys.appointments, JSON.stringify([
      appointment({ id: 'mon', date: '2026-11-09', time: '09:00', reason: 'Monday follow-up' }),
      appointment({ id: 'wed', date: '2026-11-11', time: '10:00', reason: 'Wednesday review' }),
      appointment({ id: 'next-mon', date: '2026-11-16', time: '11:00', reason: 'Next week visit' }),
    ]))
    const user = createUser()
    renderDemo()
    await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', { name: /^Appointments/ }))

    expect(screen.getByText('2 appointments this work week')).toBeInTheDocument()
    expect(screen.getAllByText('Monday follow-up').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Wednesday review').length).toBeGreaterThan(0)
    expect(screen.queryByText('Next week visit')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next week' }))
    expect(screen.getByText('1 appointment this work week')).toBeInTheDocument()
    expect(screen.getAllByText('Next week visit').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Today' }))
    expect(screen.getByText('2 appointments this work week')).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Calendar view' }), 'day')
    expect(screen.getByRole('heading', { name: 'Day schedule' })).toBeInTheDocument()
    expect(screen.getByText('1 appointment on this day')).toBeInTheDocument()
    expect(screen.queryByText('Wednesday review')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next day' }))
    await user.click(screen.getByRole('button', { name: 'Next day' }))
    expect(screen.getAllByText('Wednesday review').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    expect(screen.getAllByText('Monday follow-up').length).toBeGreaterThan(0)
  })

  it('refreshes today’s dashboard schedule across midnight without reload', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date(2026, 10, 9, 23, 59, 45))
    localStorage.setItem(storageKeys.appointments, JSON.stringify([
      appointment({ id: 'mon', date: '2026-11-09', time: '09:00', reason: 'Monday follow-up' }),
      appointment({ id: 'tue', date: '2026-11-10', time: '10:00', reason: 'Tuesday consultation' }),
    ]))
    renderDemo()
    expect(screen.getByText('Monday follow-up')).toBeInTheDocument()
    expect(screen.queryByText('Tuesday consultation')).not.toBeInTheDocument()

    act(() => {
      vi.setSystemTime(new Date(2026, 10, 10, 0, 0, 15))
      vi.advanceTimersByTime(30_000)
    })
    expect(screen.queryByText('Monday follow-up')).not.toBeInTheDocument()
    expect(screen.getByText('Tuesday consultation')).toBeInTheDocument()
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

  async function openOnlineBookingFor(user: ReturnType<typeof createUser>, date: string) {
    renderDemo()
    await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', { name: /^Appointments/ }))
    const panel = within(screen.getByRole('region', { name: 'Online booking' }))
    fireEvent.change(panel.getByLabelText('Online booking date'), { target: { value: date } })
    return panel
  }

  it('keeps the selected date intact when cleared on both the doctor and patient online booking panels', async () => {
    localStorage.setItem(storageKeys.patients, JSON.stringify([sofia(), secondPatient()]))
    localStorage.setItem(storageKeys.onlineDates, JSON.stringify([tomorrow]))
    const user = createUser()

    const doctor = await openOnlineBookingFor(user, tomorrow)
    fireEvent.change(doctor.getByLabelText('Online booking date'), { target: { value: '' } })
    expect(doctor.getByLabelText('Online booking date')).toHaveValue(tomorrow)
    cleanup()

    render(<App />)
    await signIntoDemo(user, 'Patient')
    const dateInput = bookingRegion().getByLabelText('Date', { exact: true })
    fireEvent.change(dateInput, { target: { value: tomorrow } })
    fireEvent.change(dateInput, { target: { value: '' } })
    expect(dateInput).toHaveValue(tomorrow)
    expect(bookingRegion().getByRole('button', { name: /11:00 AM · Open/ })).toBeEnabled()
  })

  it('lets a doctor open and stop online booking for a day, and lets Sofia book an open slot', async () => {
    localStorage.setItem(storageKeys.patients, JSON.stringify([sofia(), secondPatient()]))
    const user = createUser()
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
    expect(savedAppointments()).toEqual([expect.objectContaining({
      patientId: 'p-1001', date: tomorrow, time: '11:00', duration: 30, status: 'scheduled', source: 'online', reason: 'Online booking · Follow-up on blood pressure',
    })])
    cleanup()

    const doctorAgain = await openOnlineBookingFor(user, tomorrow)
    await user.click(doctorAgain.getByRole('button', { name: 'Stop online bookings for this day' }))
    expect(JSON.parse(localStorage.getItem(storageKeys.onlineDates)!)).toEqual([])
  })

  it('hides other patient names, enforces open-day and passed-time limits, and refuses a second booking the same day', async () => {
    localStorage.setItem(storageKeys.patients, JSON.stringify([sofia(), secondPatient()]))
    localStorage.setItem(storageKeys.onlineDates, JSON.stringify([today]))
    localStorage.setItem(storageKeys.appointments, JSON.stringify([
      appointment({ id: 'a-bea', patientId: 'patient-b', date: tomorrow, time: '10:00', duration: 30 }),
      appointment({ id: 'a-sofia', patientId: 'p-1001', date: tomorrow, time: '09:00', duration: 30 }),
    ]))
    const user = createUser()
    render(<App />)
    await signIntoDemo(user, 'Patient')

    expect(bookingRegion().getByRole('button', { name: /9:00 AM · Passed/ })).toBeDisabled()
    expect(bookingRegion().getByRole('button', { name: /9:30 AM · Open/ })).toBeEnabled()

    fireEvent.change(bookingRegion().getByLabelText('Date', { exact: true }), { target: { value: tomorrow } })
    expect(bookingRegion().getByRole('button', { name: /10:00 AM · Booked/ })).toBeDisabled()
    expect(bookingRegion().getByRole('button', { name: /11:00 AM · Not open online/ })).toBeDisabled()
    expect(bookingRegion().getByText(/not accepting online bookings on this day/)).toBeInTheDocument()
    expect(screen.queryByText(/Bea Cruz/)).not.toBeInTheDocument()

    localStorage.setItem(storageKeys.onlineDates, JSON.stringify([today, tomorrow]))
    cleanup()
    render(<App />)
    await signIntoDemo(user, 'Patient')
    fireEvent.change(bookingRegion().getByLabelText('Date', { exact: true }), { target: { value: tomorrow } })
    await user.click(bookingRegion().getByRole('button', { name: /11:00 AM · Open/ }))
    await user.click(bookingRegion().getByRole('button', { name: 'Confirm booking' }))
    expect(bookingRegion().getByRole('alert')).toHaveTextContent('You already have an appointment on this day.')
    expect(savedAppointments()).toHaveLength(2)
  })
})
