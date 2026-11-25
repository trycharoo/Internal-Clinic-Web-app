import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect } from 'vitest'
import App from '../App'
import { type Appointment, type Patient, type QueueSession } from '../clinic'
import { patient, storageKeys } from './fixtures'

export const secondPatient = () => patient({
  id: 'patient-b',
  name: 'Bea Cruz',
  initials: 'BC',
  patientNumber: 'PT-10002',
  phone: '09179876543',
  email: 'bea@example.test',
})

export const demoAccounts = {
  Doctor: { email: 'doctor@northstar.demo', password: 'DoctorDemo123!', path: '/demo/doctor', heading: /Good morning, Maya/ },
  Attendant: { email: 'secretary@northstar.demo', password: 'StaffDemo123!', path: '/demo/attendant', heading: /^Reception workspace$/ },
  Patient: { email: 'patient@northstar.demo', password: 'PatientDemo123!', path: '/demo/patient', heading: /^Welcome, Sofia\.$/ },
} as const

export type TestDemoRole = keyof typeof demoAccounts

export function createUser(options?: Parameters<typeof userEvent.setup>[0]) {
  return userEvent.setup({ delay: null, ...options })
}

export function seedBaseStorage() {
  localStorage.setItem(storageKeys.patients, JSON.stringify([patient(), secondPatient()]))
  localStorage.setItem(storageKeys.appointments, '[]')
}

export function renderDemo() {
  const view = render(<App />)
  if (!new URLSearchParams(window.location.search).get('queue')) {
    fireEvent.click(screen.getByRole('button', { name: 'Explore demo workspace' }))
  }
  return view
}

export async function signIntoDemo(user: ReturnType<typeof createUser>, role: TestDemoRole) {
  await user.click(screen.getByRole('button', { name: role === 'Attendant' ? 'Attendant / Secretary' : role }))
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: demoAccounts[role].email } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: demoAccounts[role].password } })
  await user.click(screen.getByRole('button', { name: `Sign in as ${role}` }))
}

export function savedPatients(): Patient[] {
  return JSON.parse(localStorage.getItem(storageKeys.patients)!)
}

export function savedQueue(): QueueSession {
  return JSON.parse(localStorage.getItem(storageKeys.queue)!)
}

export function savedAppointments(): Appointment[] {
  return JSON.parse(localStorage.getItem(storageKeys.appointments)!)
}

export async function openChart(user: ReturnType<typeof createUser>, name = 'Alice Santos') {
  const searchField = screen.getByRole('textbox', { name: 'Search patients' })
  fireEvent.change(searchField, { target: { value: name } })
  await user.click(within(searchField.parentElement!).getByRole('button', { name: new RegExp(name) }))
  expect(screen.getByRole('heading', { level: 1, name })).toBeInTheDocument()
}

export async function startVisit(user: ReturnType<typeof createUser>) {
  await user.click(screen.getAllByRole('button', { name: 'Start visit' })[0])
}

export async function prescriptionTab(user: ReturnType<typeof createUser>) {
  await user.click(screen.getByRole('button', { name: /^Prescriptions\s*\d+/ }))
}

export async function openQueue(user: ReturnType<typeof createUser>) {
  await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', { name: /^Daily queue/ }))
}

export async function fillCheckIn(user: ReturnType<typeof createUser>, name: string, reason = '', symptoms = '') {
  fireEvent.change(screen.getByRole('textbox', { name: /Full name/ }), { target: { value: name } })
  fireEvent.change(screen.getByRole('textbox', { name: /Phone number/ }), { target: { value: '09171234567' } })
  fireEvent.change(document.querySelector<HTMLInputElement>('input[type="date"]')!, { target: { value: '1990-05-10' } })
  await user.selectOptions(screen.getByRole('combobox', { name: /Sex/ }), 'Female')
  await user.selectOptions(screen.getByRole('combobox', { name: /Allergy status/ }), 'none')
  if (reason) fireEvent.change(screen.getByRole('textbox', { name: /What brings you in today/ }), { target: { value: reason } })
  if (symptoms) fireEvent.change(screen.getByRole('textbox', { name: /How are you feeling/ }), { target: { value: symptoms } })
}

export async function joinPreview(user: ReturnType<typeof createUser>, name: string, phone: string, sex = 'Female', birthDate = '1990-05-10') {
  await user.click(screen.getByRole('button', { name: 'Preview patient check-in' }))
  fireEvent.change(screen.getByRole('textbox', { name: /Full name/ }), { target: { value: name } })
  fireEvent.change(screen.getByRole('textbox', { name: /Phone number/ }), { target: { value: phone } })
  fireEvent.change(document.querySelector<HTMLInputElement>('input[type="date"]')!, { target: { value: birthDate } })
  await user.selectOptions(screen.getByRole('combobox', { name: /Sex/ }), sex)
  await user.selectOptions(screen.getByRole('combobox', { name: /Allergy status/ }), 'none')
  await user.click(screen.getByRole('button', { name: 'Get my queue number' }))
}
