import { expect, navigate, signInAs, test, type Page } from './support'

// Patient online booking (demo): the doctor opens a day, the patient sees which times are free, and books one.
// Patients see booked times without any other patient's name. The sign-in is a demo, not authentication.

async function openDayForOnlineBooking(page: Page, date: string) {
  await signInAs(page, 'Doctor')
  await navigate(page, /^Appointments$/)
  const panel = page.getByRole('region', { name: 'Online booking' })
  await panel.getByLabel('Online booking date').fill(date)
  await panel.getByRole('button', { name: 'Accept online bookings for this day' }).click()
  await expect(panel.getByRole('button', { name: 'Stop online bookings for this day' })).toBeVisible()
}

function bookingCard(page: Page) {
  return page.getByRole('region', { name: 'Book online' })
}

test.beforeEach(async ({ page }) => {
  // Monday 9 November 2026, 09:00 in Manila: seed appointments are booked for today and tomorrow.
  await page.clock.setFixedTime(new Date('2026-11-09T01:00:00Z'))
  await page.goto('/')
})

test('the doctor opens Tuesday for online booking, and Sofia books a free time without seeing anyone else’s name', async ({ page }) => {
  await test.step('Dr. Reyes opens Tuesday 10 November for online booking from the Appointments page', async () => {
    await openDayForOnlineBooking(page, '2026-11-10')
  })

  await test.step('Sofia Reyes signs in to her patient view and sees the day: 10:00 is taken, and no name is shown', async () => {
    await signInAs(page, 'Patient')
    await bookingCard(page).getByLabel('Date', { exact: true }).fill('2026-11-10')
    await expect(bookingCard(page).getByRole('button', { name: /10:00 AM · Booked/ })).toBeDisabled()
    await expect(bookingCard(page).getByRole('button', { name: /11:00 AM · Open/ })).toBeEnabled()
    await expect(page.locator('.role-demo-shell')).not.toContainText('Liza Garcia')
  })

  await test.step('She books 11:00 for a blood pressure follow-up and receives a reference', async () => {
    await bookingCard(page).getByRole('button', { name: /11:00 AM · Open/ }).click()
    await bookingCard(page).getByLabel(/Reason for visit/).fill('Follow-up on my blood pressure')
    await bookingCard(page).getByRole('button', { name: 'Confirm booking' }).click()
    await expect(bookingCard(page).getByRole('status')).toContainText('Booked for Tuesday, November 10, 2026 at 11:00 AM')
    await expect(bookingCard(page).getByRole('status')).toContainText('Reference')
    await expect(bookingCard(page).getByRole('button', { name: /11:00 AM · Booked/ })).toBeDisabled()
    await expect(bookingCard(page).locator('.patient-upcoming')).toContainText('11:00 AM · Online booking · Follow-up on my blood pressure')
  })

  await test.step('Dr. Reyes sees the online booking on Tuesday’s schedule, marked as online', async () => {
    await signInAs(page, 'Doctor')
    await navigate(page, /^Appointments$/)
    await expect(page.locator('.upcoming-list')).toContainText('Online booking · Follow-up on my blood pressure')
  })
})

test('a day the doctor has not opened shows booked times but cannot be booked, until the doctor opens it', async ({ page }) => {
  await test.step('Sofia looks at Thursday 12 November, which Dr. Reyes has not opened for online booking', async () => {
    await signInAs(page, 'Patient')
    await bookingCard(page).getByLabel('Date', { exact: true }).fill('2026-11-12')
    await expect(bookingCard(page).getByText(/not accepting online bookings on this day/)).toBeVisible()
    await expect(bookingCard(page).getByRole('button', { name: /9:30 AM · Not open online/ })).toBeDisabled()
  })

  await test.step('Dr. Reyes opens Thursday, and Sofia books the first free time', async () => {
    await openDayForOnlineBooking(page, '2026-11-12')
    await signInAs(page, 'Patient')
    await bookingCard(page).getByLabel('Date', { exact: true }).fill('2026-11-12')
    await bookingCard(page).getByRole('button', { name: /9:30 AM · Open/ }).click()
    await bookingCard(page).getByRole('button', { name: 'Confirm booking' }).click()
    await expect(bookingCard(page).getByRole('status')).toContainText('Booked for Thursday, November 12, 2026 at 9:30 AM')
  })

  await test.step('A second booking on the same day is refused, because she already has one', async () => {
    await bookingCard(page).getByRole('button', { name: /10:00 AM · Open/ }).click()
    await bookingCard(page).getByRole('button', { name: 'Confirm booking' }).click()
    await expect(bookingCard(page).getByRole('alert')).toContainText('You already have an appointment on this day.')
  })
})
