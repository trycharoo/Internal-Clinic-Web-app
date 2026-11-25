import { checkInAsPatient, expect, navigate, openChart, signInAs, test } from './support'

async function hasNoHorizontalOverflow(page: Parameters<typeof test>[1] extends never ? never : import('./support').Page) {
  return page.evaluate(() => {
    const browserWindow = globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number }
    return browserWindow.document.documentElement.scrollWidth <= browserWindow.innerWidth
  })
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-09T01:00:00Z'))
  await page.goto('/')
})

test('sign-in forms and hero stay responsive on mobile without horizontal overflow', async ({ page }) => {
  const heroImage = page.locator('.login-hero-image')
  await expect.poll(() => heroImage.evaluate((image) => {
    const photo = image as unknown as { complete: boolean; naturalWidth: number }
    return photo.complete && photo.naturalWidth > 0
  })).toBe(true)

  for (const [role, heading, submitRole] of [
    ['Patient', 'Your care starts here.', 'Patient'],
    ['Attendant / Secretary', 'A smoother day starts here.', 'Attendant'],
    ['Doctor', 'Welcome back, doctor.', 'Doctor'],
  ]) {
    await page.getByRole('button', { name: role, exact: true }).click()
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    await page.getByRole('button', { name: `Sign in as ${submitRole}` }).click()
    await expect(page.getByLabel('Email address', { exact: true })).toHaveAttribute('aria-invalid', 'true')
    expect(await hasNoHorizontalOverflow(page)).toBe(true)
  }
})

test('mobile navigation drawer opens patients directory and patient chart cleanly', async ({ page }) => {
  await page.getByRole('button', { name: 'Explore demo workspace' }).click()
  await openChart(page, 'Sofia Reyes')
  await expect(page.locator('.chart-alert')).toContainText('Penicillin')
  expect(await hasNoHorizontalOverflow(page)).toBe(true)
})

test('patient self check-in form and queue status board fit cleanly on mobile', async ({ page }) => {
  await page.getByRole('button', { name: 'Explore demo workspace' }).click()
  await navigate(page, /^Daily queue/)
  await page.getByRole('button', { name: 'Generate today’s QR' }).click()
  await expect(page.getByRole('img', { name: 'QR code for today’s patient check-in', exact: true })).toBeVisible()

  await signInAs(page, 'Patient')
  await checkInAsPatient(page, { name: 'Sofia Reyes', phone: '0917-555-0142', birthDate: '1994-05-12', allergyStatus: 'none' })
  await expect(page.getByRole('status')).toContainText('R-001')
  await expect(page.getByLabel('Queue status')).toContainText('You are next.')
  expect(await hasNoHorizontalOverflow(page)).toBe(true)
})

test('patient online booking slot grid works cleanly on mobile', async ({ page }) => {
  await signInAs(page, 'Doctor')
  await navigate(page, /^Appointments$/)
  const panel = page.getByRole('region', { name: 'Online booking' })
  await panel.getByLabel('Online booking date').fill('2026-11-10')
  await panel.getByRole('button', { name: 'Accept online bookings for this day' }).click()

  await signInAs(page, 'Patient')
  const booking = page.getByRole('region', { name: 'Book online' })
  await booking.getByLabel('Date', { exact: true }).fill('2026-11-10')
  await booking.getByRole('button', { name: /11:00 AM · Open/ }).click()
  await booking.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(booking.getByRole('status')).toContainText('Booked for Tuesday, November 10, 2026 at 11:00 AM')
  expect(await hasNoHorizontalOverflow(page)).toBe(true)
})
