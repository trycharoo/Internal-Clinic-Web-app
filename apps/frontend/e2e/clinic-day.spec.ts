import { readFile } from 'node:fs/promises'
import { checkInAsPatient, currentCheckInLink, expect, navigate, openChart, savedChart, savedPatientCount, savedQueueEntries, signInAs, test, type Page } from './support'

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-09T01:00:00Z'))
  await page.goto('/')
})

async function generateTodaysQr(page: Page) {
  await page.getByRole('button', { name: 'Explore demo workspace' }).click()
  await navigate(page, /^Daily queue/)
  await page.getByRole('button', { name: 'Generate today’s QR' }).click()
  await expect(page.getByRole('img', { name: 'QR code for today’s patient check-in', exact: true })).toBeVisible()
}

test('walk-in validation, unknown allergy, visit draft isolation, prescription print, and reload persistence', async ({ page }) => {
  const before = await savedPatientCount(page)

  await test.step('SRS 2: invalid walk-in registration stays open and cancelling leaves no chart', async () => {
    await signInAs(page, 'Attendant')
    await page.getByRole('button', { name: 'New walk-in', exact: true }).click()
    const registration = page.getByRole('dialog', { name: 'New walk-in patient' })
    await registration.getByLabel('Date of birth', { exact: true }).fill('1990-02-02')
    await registration.getByLabel(/^Sex/).selectOption('Female')
    await registration.getByLabel(/^Allergy status/).selectOption('none')
    await registration.getByRole('button', { name: 'Register patient' }).click()
    await expect(registration).toBeVisible()
    expect(await savedPatientCount(page)).toBe(before)

    await registration.getByLabel(/^Patient name/).fill('Lorna Padilla')
    await registration.getByLabel('Date of birth', { exact: true }).fill('2999-01-01')
    await registration.getByRole('button', { name: 'Register patient' }).click()
    await expect(registration).toBeVisible()
    await registration.getByRole('button', { name: 'Cancel' }).click()
    await expect(registration).toBeHidden()
    expect(await savedPatientCount(page)).toBe(before)
  })

  await test.step('SRS 1: unknown allergy is registered as "Not recorded", never "No known allergies"', async () => {
    await page.getByRole('button', { name: 'New walk-in', exact: true }).click()
    const registration = page.getByRole('dialog', { name: 'New walk-in patient' })
    await registration.getByLabel(/^Patient name/).fill('Ramon Dizon')
    await registration.getByLabel('Date of birth', { exact: true }).fill('1979-08-21')
    await registration.getByLabel(/^Sex/).selectOption('Male')
    await registration.getByLabel(/^Allergy status/).selectOption('unknown')
    await registration.getByRole('button', { name: 'Register patient' }).click()
    await expect(registration).toBeHidden()
    expect(await savedPatientCount(page)).toBe(before + 1)

    await signInAs(page, 'Doctor')
    await openChart(page, 'Ramon Dizon')
    await expect(page.locator('.chart-alert')).toContainText('Not recorded')
    await expect(page.locator('.chart-alert')).not.toContainText('No known allergies')
  })

  await test.step('SRS 7 & 8: empty visit is rejected, saved history stays immutable, and drafts stay patient-isolated', async () => {
    await page.getByRole('button', { name: 'Start visit', exact: true }).first().click()
    await page.getByRole('button', { name: 'Save visit to chart' }).click()
    await expect(page.getByText('Add a note, signs, symptoms, or diagnosis before saving.')).toBeVisible()

    await page.getByLabel(/^Interview notes/).fill('First saved interview note')
    await page.getByLabel(/^Signs/).fill('Synthetic observed findings')
    await page.getByLabel(/^Symptoms/).fill('Synthetic reported concern')
    await page.getByLabel('Assessment / diagnosis').fill('First saved assessment')
    await page.getByRole('button', { name: 'Save visit to chart' }).click()
    await expect(page.getByRole('heading', { name: 'Medical history', exact: true })).toBeVisible()
    await expect(page.getByText('First saved interview note', { exact: true })).toBeVisible()

    await page.locator('.chart-tabs').getByRole('button', { name: /^Visit notes/ }).click()
    await page.getByLabel(/^Interview notes/).fill('Ramon unsaved draft note')
    await page.getByLabel('Assessment / diagnosis').fill('Ramon unsaved assessment')
    await page.locator('.chart-tabs').getByRole('button', { name: /^Medical history/ }).click()
    await expect(page.getByText('First saved interview note', { exact: true })).toBeVisible()
    await expect(page.getByText('Ramon unsaved draft note')).toHaveCount(0)

    await openChart(page, 'Mateo Cruz')
    await page.getByRole('button', { name: 'Start visit', exact: true }).first().click()
    await expect(page.getByLabel(/^Interview notes/)).toHaveValue('')
    await expect(page.getByLabel('Assessment / diagnosis')).toHaveValue('')

    await openChart(page, 'Ramon Dizon')
    await page.getByRole('button', { name: 'Start visit', exact: true }).first().click()
    await expect(page.getByLabel(/^Interview notes/)).toHaveValue('Ramon unsaved draft note')
    await expect(page.getByLabel('Assessment / diagnosis')).toHaveValue('')
  })

  await test.step('SRS 9: prescription print preview carries demo-draft notice and survives reload', async () => {
    await page.locator('.chart-tabs').getByRole('button', { name: /^Prescriptions/ }).click()
    await page.getByLabel(/^Medication name/).fill('Cetirizine')
    await page.getByLabel(/^Strength/).fill('10 mg')
    await page.getByLabel('Directions for use').fill('One tablet by mouth at night, for sneezing')
    await page.getByRole('button', { name: 'Add to chart', exact: true }).click()
    await expect(page.locator('.prescription-list')).toContainText('Cetirizine')

    await page.emulateMedia({ media: 'print' })
    const printed = page.locator('#print-prescription')
    await expect(printed).toBeVisible()
    await expect(printed).toContainText('DEMO DRAFT — not a finalized prescription')
    await expect(printed).toContainText('Rx · DRAFT')
    await expect(printed).toContainText('Dr. Maya Reyes (sample clinician)')
    await expect(printed).toContainText('Sample identity · not authenticated')
    await expect(printed).toContainText('Ramon Dizon')
    await page.emulateMedia({ media: 'screen' })

    await page.reload()
    await signInAs(page, 'Doctor')
    await openChart(page, 'Ramon Dizon')
    await expect(page.locator('.chart-alert')).toContainText('Not recorded')
    await page.locator('.chart-tabs').getByRole('button', { name: /^Medical history/ }).click()
    await expect(page.getByText('First saved interview note', { exact: true })).toBeVisible()
    await page.locator('.chart-tabs').getByRole('button', { name: /^Prescriptions/ }).click()
    await expect(page.locator('.prescription-list')).toContainText('Cetirizine')
  })
})

test('SRS 3: chart scheduling preselects the patient, rejects overlap, accepts adjacent slot, and survives reload', async ({ page }) => {
  await page.getByRole('button', { name: 'Explore demo workspace' }).click()
  await openChart(page, 'Paolo Mendoza')
  await page.getByRole('button', { name: 'Schedule', exact: true }).click()
  const booking = page.getByRole('dialog', { name: 'Book an appointment' })
  await expect(booking.locator('#appointment-patient option:checked')).toContainText('Paolo Mendoza')

  await booking.getByLabel(/^Start time/).selectOption('09:30')
  await booking.getByRole('button', { name: 'Confirm appointment' }).click()
  await expect(booking.getByRole('alert')).toContainText('That time overlaps an existing appointment')
  await expect(booking).toBeVisible()

  await booking.getByLabel(/^Start time/).selectOption('10:00')
  await booking.getByRole('button', { name: 'Confirm appointment' }).click()
  await expect(booking).toBeHidden()
  await expect(page.locator('.upcoming-list .upcoming-row')).toHaveCount(6)

  await page.reload()
  await signInAs(page, 'Doctor')
  await navigate(page, /^Appointments$/)
  await expect(page.locator('.upcoming-list .upcoming-row')).toHaveCount(6)
  await expect(page.locator('.upcoming-list .upcoming-row').filter({ hasText: 'Paolo Mendoza' })).toHaveCount(2)
  await expect(page.locator('.upcoming-list .upcoming-row').filter({ hasText: 'Paolo Mendoza' }).filter({ hasText: '10:00 AM' })).toHaveCount(1)
})

test('uploaded document text is reviewed, editable, and persisted in the patient chart', async ({ page }) => {
  await page.getByRole('button', { name: 'Explore demo workspace' }).click()
  await page.route('**/api/documents/parse', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ filename: 'lab-result.pdf', file_type: 'pdf', page_count: 2, ocr_pages_used: [2], text: 'Extracted synthetic lab result', processing_time_ms: 20 }),
  }))
  await openChart(page, 'Sofia Reyes')
  await page.getByLabel('Choose a patient document').setInputFiles({ name: 'lab-result.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 synthetic fixture') })
  const review = page.getByRole('dialog', { name: 'Review extracted text' })
  await expect(review).toContainText('OCR pages 2')
  await review.getByLabel(/Extracted text/).fill('Doctor reviewed and corrected the lab result.')
  await review.getByRole('button', { name: 'Save to patient chart' }).click()
  await expect(page.locator('.patient-document')).toContainText('Doctor reviewed and corrected the lab result.')

  await page.reload()
  await page.getByRole('button', { name: 'Explore demo workspace' }).click()
  await openChart(page, 'Sofia Reyes')
  await page.locator('.chart-tabs').getByRole('button', { name: /^Documents/ }).click()
  await expect(page.locator('.patient-document')).toContainText('Doctor reviewed and corrected the lab result.')
})

test('full working day: QR deduplication, triage, allergy removal review, QR rotation, lunch pause, expiry, and context isolation', async ({ page, browser }) => {
  const baseline = await savedPatientCount(page)
  await generateTodaysQr(page)
  const morningLink = await currentCheckInLink(page)

  await test.step('SRS 4: returning patient deduplicates across case/phone formatting; new walk-in gets R-002', async () => {
    await signInAs(page, 'Patient')
    await checkInAsPatient(page, { name: 'Sofia Reyes', phone: '0917-555-0142', birthDate: '1994-05-12', allergyStatus: 'none' })
    await expect(page.getByRole('status')).toContainText('R-001')
    await page.getByRole('button', { name: 'Back to clinic' }).click()

    await checkInAsPatient(page, { name: 'sofia reyes', phone: '09175550142', birthDate: '1994-05-12', allergyStatus: 'none' })
    await expect(page.getByRole('status')).toContainText('R-001')
    await page.getByRole('button', { name: 'Back to clinic' }).click()

    await checkInAsPatient(page, { name: 'Ramon Dizon', phone: '0917-555-0161', birthDate: '1979-08-21', sex: 'Male' })
    await expect(page.getByRole('status')).toContainText('R-002')
    await page.getByRole('button', { name: 'Back to clinic' }).click()
    expect(await savedPatientCount(page)).toBe(baseline + 1)
  })

  await test.step('ALL-01 & TRI-01: triage keeps documented allergy and doctor removes it only with a reason', async () => {
    await signInAs(page, 'Attendant')
    await page.getByRole('button', { name: 'Record triage' }).first().click()
    let triage = page.getByRole('dialog', { name: 'Record triage' })
    await triage.getByLabel(/^Chief complaint/).fill('Sneezing and blocked nose')
    await triage.getByLabel(/^Confirmed allergy status/).selectOption('none')
    await expect(triage).toContainText('Triage cannot remove a documented allergy')
    await triage.getByRole('checkbox', { name: /verified the allergy status/ }).check()
    await triage.getByRole('button', { name: 'Save triage & hand off' }).click()
    expect(await savedChart(page, 'Sofia Reyes')).toMatchObject({ allergyStatus: 'known', allergy: 'Penicillin' })

    await page.getByRole('button', { name: 'Record triage' }).first().click()
    triage = page.getByRole('dialog', { name: 'Record triage' })
    await triage.getByLabel(/^Chief complaint/).fill('Itchy rash on forearms')
    await triage.getByLabel(/^Confirmed allergy status/).selectOption('known')
    await triage.getByLabel(/^Confirmed allergies/).fill('Shellfish')
    await triage.getByRole('checkbox', { name: /verified the allergy status/ }).check()
    await triage.getByRole('button', { name: 'Save triage & hand off' }).click()
    expect(await savedChart(page, 'Ramon Dizon')).toMatchObject({ allergyStatus: 'known', allergy: 'Shellfish' })

    await signInAs(page, 'Doctor')
    await navigate(page, /^Daily queue/)
    await page.getByRole('button', { name: 'Start consultation' }).first().click()
    const visit = page.getByRole('dialog', { name: 'Complete visit' })
    await visit.getByLabel(/^Assessment \/ diagnosis/).fill('Allergic rhinitis, seasonal')
    await visit.getByLabel(/^Consultation notes/).fill('Penicillin allergy ruled out with patient history.')
    await visit.getByRole('checkbox', { name: /reviewed the allergy information/ }).check()
    await visit.getByRole('radio', { name: /Remove documented allergy/ }).check()
    await expect(visit.getByRole('button', { name: 'Save visit to patient history' })).toBeDisabled()
    await visit.getByLabel(/^Reason for removing/).fill('Penicillin allergy ruled out by clinical history')
    await visit.getByRole('button', { name: 'Save visit to patient history' }).click()
    await expect(page.locator('.queue-table-row').filter({ hasText: 'Visit complete' })).toHaveCount(1)

    const chart = await savedChart(page, 'Sofia Reyes')
    expect(chart).toMatchObject({ allergyStatus: 'none', allergy: 'No known allergies' })
    expect(chart?.records[0].allergyReview).toEqual({
      decision: 'removed', reportedStatus: 'none', documentedAllergy: 'Penicillin', reason: 'Penicillin allergy ruled out by clinical history',
    })
  })

  await test.step('SRS 5: QR rotation invalidates old link, lunch pause blocks intake, resume restores, and next day expires', async () => {
    await page.getByRole('button', { name: 'Rotate QR' }).click()
    await page.getByRole('button', { name: 'Replace QR code' }).click()
    await expect(page.locator('.toast')).toContainText('The previous code no longer works')

    await page.goto(morningLink)
    await expect(page.getByRole('alert')).toContainText('This check-in link isn’t connected')
    expect((await savedQueueEntries(page)).map((entry) => entry.number)).toEqual(['R-001', 'R-002'])

    await page.getByRole('button', { name: 'Back to clinic' }).click()
    await signInAs(page, 'Attendant')
    await page.getByRole('button', { name: 'Pause check-in' }).click()
    await expect(page.getByText('Check-in paused', { exact: true }).first()).toBeVisible()

    const rotatedLink = await currentCheckInLink(page)
    await page.goto(rotatedLink)
    await expect(page.getByText('Check-in is paused', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Get my queue number' })).toBeHidden()

    await page.getByRole('button', { name: 'Back to clinic' }).click()
    await signInAs(page, 'Attendant')
    await page.getByRole('button', { name: 'Resume check-in' }).click()

    const phone = await browser.newContext({ timezoneId: 'Asia/Manila' })
    try {
      const phonePage = await phone.newPage()
      await phonePage.clock.setFixedTime(new Date('2026-11-09T01:00:00Z'))
      await phonePage.goto(rotatedLink)
      await expect(phonePage.getByRole('alert')).toContainText('This check-in link isn’t connected')
    } finally {
      await phone.close()
    }

    await page.clock.setFixedTime(new Date('2026-11-10T01:00:00Z'))
    await page.goto(rotatedLink)
    await expect(page.getByRole('alert')).toContainText('This check-in link isn’t connected')
  })
})

test('SRS 10: role sign-in validation, distinct demo routes, direct-URL guards, and zero credential persistence', async ({ page }) => {
  await expect(page).toHaveURL(/\/login$/)
  for (const route of ['/demo/patient', '/demo/attendant', '/demo/doctor']) {
    await page.goto(route)
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeHidden()
  }

  await page.getByRole('button', { name: 'Patient', exact: true }).click()
  await page.getByLabel('Email address', { exact: true }).fill('doctor@northstar.demo')
  await page.getByLabel('Password', { exact: true }).fill('DoctorDemo123!')
  await page.getByRole('button', { name: 'Sign in as Patient' }).click()
  await expect(page.getByRole('alert')).toContainText('These demo credentials do not match the selected role.')
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('')

  const accounts = [
    { role: 'Patient', label: 'Patient', path: '/demo/patient', heading: 'Welcome, Sofia.' },
    { role: 'Attendant', label: 'Attendant / Secretary', path: '/demo/attendant', heading: 'Reception workspace' },
    { role: 'Doctor', label: 'Doctor', path: '/demo/doctor', heading: /Good morning, Maya/ },
  ]
  for (const account of accounts) {
    await page.getByRole('button', { name: account.label, exact: true }).click()
    await page.getByText('Demo credentials', { exact: true }).click()
    await page.getByRole('button', { name: 'Use demo credentials' }).click()
    await page.getByRole('button', { name: `Sign in as ${account.role}` }).click()
    await expect(page).toHaveURL(new RegExp(`${account.path}$`))
    await expect(page.getByRole('heading', { name: account.heading })).toBeVisible()
    if (account.role === 'Patient') {
      await expect(page.getByRole('button', { name: /New walk-in|Book appointment|Record triage|Clinical notes|Prescriptions/ })).toHaveCount(0)
    }
    if (account.role === 'Attendant') {
      await expect(page.getByRole('button', { name: /Clinical notes|Prescriptions|Start consultation|Generate today’s QR|View history/ })).toHaveCount(0)
    }
    const persisted = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
    expect(persisted).not.toContain('Demo123!')
    await page.getByRole('button', { name: 'Log in as' }).click()
    await expect(page).toHaveURL(/\/login$/)
    await page.goBack()
    await expect(page).toHaveURL(/\/login$/)
  }

  await page.getByRole('button', { name: 'Explore demo workspace' }).click()
  await expect(page).toHaveURL(/\/demo\/doctor$/)
  await page.reload()
  await expect(page).toHaveURL(/\/login$/)
})

test('wide desktop sign-in layout and local cover preview work without leaking to storage', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  const hero = page.locator('.login-hero-image')
  await expect.poll(() => hero.evaluate((image) => {
    const photo = image as unknown as { complete: boolean; naturalWidth: number }
    return photo.complete && photo.naturalWidth > 0
  })).toBe(true)

  const form = await page.locator('.login-form').boundingBox()
  const panel = await page.locator('.login-main').boundingBox()
  const heroBox = await hero.boundingBox()
  expect(form?.width).toBeGreaterThanOrEqual(360)
  expect(panel!.x).toBeGreaterThan(heroBox!.x + heroBox!.width / 2)
  expect(await page.evaluate(() => {
    const browserWindow = globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number }
    return browserWindow.document.documentElement.scrollWidth <= browserWindow.innerWidth
  })).toBe(true)

  const originalStorage = await page.evaluate(() => JSON.stringify({ ...localStorage }))
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Change cover' }).click()
  await (await chooser).setFiles({
    name: 'synthetic-clinic-cover.jpg',
    mimeType: 'image/jpeg',
    buffer: await readFile(new URL('../public/images/clinic-hero.jpg', import.meta.url)),
  })
  await expect(hero).toHaveAttribute('src', /^blob:/)
  const uploadedSource = await hero.getAttribute('src')
  await page.getByRole('button', { name: 'Explore demo workspace' }).click()
  await page.getByRole('button', { name: 'Log in as' }).click()
  await expect(hero).toHaveAttribute('src', uploadedSource!)

  await page.getByLabel('Choose a cover image').setInputFiles({ name: 'corrupt.png', mimeType: 'image/png', buffer: Buffer.from('invalid') })
  await expect(page.getByRole('alert')).toContainText(/image|read|load/i)
  await expect(hero).toHaveAttribute('src', uploadedSource!)
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).toBe(originalStorage)

  await page.getByRole('button', { name: 'Reset cover' }).click()
  await expect(hero).toHaveAttribute('src', '/images/clinic-hero.jpg')
})
