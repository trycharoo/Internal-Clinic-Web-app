import { test as base, expect, type Page } from '@playwright/test'

// Fails any journey that throws an unhandled error in the application.
export const test = base.extend<{ runtimeErrors: void }>({
  runtimeErrors: [async ({ page }, use) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await use()
    expect(errors, 'The browser should have no unhandled application errors').toEqual([])
  }, { auto: true }],
})

export { expect }
export type { Page }

export const PATIENTS_KEY = 'northstar-demo-patients-v1'
export const QUEUE_KEY = 'northstar-demo-daily-queue-v1'

export type Role = 'Doctor' | 'Attendant' | 'Patient'

export async function navigate(page: Page, name: RegExp) {
  const button = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name })
  const mobileMenu = page.getByRole('button', { name: 'Open navigation' })
  if (await mobileMenu.isVisible()) await mobileMenu.click()
  await button.click()
}

export async function openChart(page: Page, name: string) {
  const globalSearch = page.getByRole('textbox', { name: 'Search patients', exact: true })
  if (await globalSearch.isVisible()) {
    await globalSearch.fill(name)
    await page.locator('.search-popover').getByRole('button', { name: new RegExp(name) }).click()
  } else {
    await navigate(page, /^Patients/)
    await page.getByPlaceholder('Search by name, patient ID, or phone').fill(name)
    await page.getByRole('row').filter({ hasText: name }).click()
  }
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
}

// Staff and patients sign in through the demo login page, as they would at the start of a shift.
export async function signInAs(page: Page, role: Role) {
  const logInAs = page.getByRole('button', { name: 'Log in as' })
  if (await logInAs.isVisible()) await logInAs.click()
  await page.getByRole('button', { name: role === 'Attendant' ? 'Attendant / Secretary' : role, exact: true }).click()
  await page.getByText('Demo credentials', { exact: true }).click()
  await page.getByRole('button', { name: 'Use demo credentials' }).click()
  await page.getByRole('button', { name: `Sign in as ${role}` }).click()
}

export type PatientCheckIn = {
  name: string
  phone: string
  birthDate: string
  sex?: string
  allergyStatus?: 'unknown' | 'none' | 'known'
  allergy?: string
  reason?: string
  symptoms?: string
}

// The patient opens check-in from their own view, fills in the form, and receives a queue number.
export async function checkInAsPatient(page: Page, details: PatientCheckIn) {
  await page.getByRole('button', { name: 'Open patient check-in' }).click()
  await page.getByLabel(/^Full name/).fill(details.name)
  await page.getByLabel(/^Phone number/).fill(details.phone)
  await page.getByLabel(/^Date of birth/).fill(details.birthDate)
  await page.getByLabel(/^Sex/).selectOption(details.sex ?? 'Female')
  await page.getByLabel(/^Allergy status/).selectOption(details.allergyStatus ?? 'unknown')
  if (details.allergyStatus === 'known') await page.getByLabel(/^Known allergies/).fill(details.allergy ?? '')
  if (details.reason) await page.getByLabel(/^What brings you in today/).fill(details.reason)
  if (details.symptoms) await page.getByLabel(/^How are you feeling/).fill(details.symptoms)
  await page.getByRole('button', { name: 'Get my queue number' }).click()
}

// The link a patient opens from the QR code, built from the token the app currently issues.
export async function currentCheckInLink(page: Page): Promise<string> {
  const token = await page.evaluate((key) => (JSON.parse(localStorage.getItem(key) || 'null') as { token: string } | null)?.token ?? '', QUEUE_KEY)
  return `${new URL(page.url()).origin}/?queue=${token}`
}

export type SavedChart = {
  id: string
  name: string
  allergyStatus: string
  allergy: string
  records: Array<{ diagnosis: string; symptoms?: string; allergyReview?: { decision: string; reportedStatus: string; documentedAllergy: string; reason: string } }>
}

// Reads a chart from the same browser storage the application writes. Null when no chart has that name.
export async function savedChart(page: Page, name: string): Promise<SavedChart | null> {
  return page.evaluate(({ key, name }) => {
    const patients = JSON.parse(localStorage.getItem(key) || '[]') as SavedChart[]
    return patients.find((patient) => patient.name === name) ?? null
  }, { key: PATIENTS_KEY, name })
}

// Number of charts in this browser's saved demo data.
export async function savedPatientCount(page: Page): Promise<number> {
  return page.evaluate((key) => (JSON.parse(localStorage.getItem(key) || '[]') as unknown[]).length, PATIENTS_KEY)
}

export async function savedQueueEntries(page: Page): Promise<Array<{ number: string; status: string; stage?: string; allergyDiscrepancy?: unknown }>> {
  return page.evaluate((key) => (JSON.parse(localStorage.getItem(key) || 'null') as { entries: Array<{ number: string; status: string; stage?: string }> } | null)?.entries ?? [], QUEUE_KEY)
}
