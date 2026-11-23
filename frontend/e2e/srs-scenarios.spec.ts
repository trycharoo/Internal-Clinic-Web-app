import { checkInAsPatient, currentCheckInLink, expect, navigate, openChart, savedChart, savedPatientCount, savedQueueEntries, signInAs, test, type Page } from './support'

// Browser journeys for the implemented SRS acceptance scenarios (docs/SRS.md). Every patient here is synthetic, and
// each journey follows one situation a Philippine clinic meets on a working day: a walk-in at the desk, a returning
// patient at the QR code, a triage nurse or secretary on shift, a doctor finishing a visit, and a QR code that must be
// replaced. Scenario 10 (sign-in and role views) lives in clinic.spec.ts; scenarios 11-12 are covered by the PostgreSQL
// and delivery checks.

test.beforeEach(async ({ page }) => {
  // Keep seed appointments on a Monday and DOB/calendar assertions stable.
  await page.clock.setFixedTime(new Date('2026-11-09T01:00:00Z'))
  await page.goto('/')
})

async function generateTodaysQr(page: Page) {
  await page.getByRole('button', { name: 'Explore demo workspace' }).click()
  await navigate(page, /^Daily queue/)
  await page.getByRole('button', { name: 'Generate today’s QR' }).click()
  await expect(page.getByRole('img', { name: 'QR code for today’s patient check-in', exact: true })).toBeVisible()
}

async function recordTriage(page: Page, values: { complaint: string; allergy: 'unknown' | 'none' | 'known'; details?: string }) {
  await page.getByRole('button', { name: 'Record triage' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Record triage' })
  await dialog.getByLabel(/^Chief complaint/).fill(values.complaint)
  await dialog.getByLabel(/^Confirmed allergy status/).selectOption(values.allergy)
  if (values.allergy === 'known') await dialog.getByLabel(/^Confirmed allergies/).fill(values.details ?? '')
  await dialog.getByRole('checkbox', { name: /verified the allergy status/ }).check()
  return dialog
}

test('SRS 1: a walk-in who is unsure of his allergies is registered as unknown, never as "no known allergies"', async ({ page }) => {
  const before = await savedPatientCount(page)
  await test.step('Ana Santos registers Ramon Dizon at the reception desk', async () => {
    await signInAs(page, 'Attendant')
    await page.getByRole('button', { name: 'New walk-in', exact: true }).click()
    const registration = page.getByRole('dialog', { name: 'New walk-in patient' })
    await registration.getByLabel(/^Patient name/).fill('Ramon Dizon')
    await registration.getByLabel('Date of birth', { exact: true }).fill('1979-08-21')
    await registration.getByLabel(/^Sex/).selectOption('Male')
    await registration.getByLabel(/^Allergy status/).selectOption('unknown')
    await registration.getByRole('button', { name: 'Register patient' }).click()
    await expect(registration).toBeHidden()
    expect(await savedPatientCount(page)).toBe(before + 1)
  })

  await test.step('Dr. Reyes opens the chart later that day and sees the allergy as not recorded', async () => {
    await signInAs(page, 'Doctor')
    await openChart(page, 'Ramon Dizon')
    await expect(page.locator('.chart-alert')).toContainText('Not recorded')
    await expect(page.locator('.chart-alert')).not.toContainText('No known allergies')
  })

  await test.step('The chart survives a browser reload', async () => {
    await page.reload()
    await signInAs(page, 'Doctor')
    await openChart(page, 'Ramon Dizon')
    await expect(page.locator('.chart-alert')).toContainText('Not recorded')
    expect(await savedPatientCount(page)).toBe(before + 1)
  })
})

test('SRS 2: an incomplete walk-in form stays open, and cancelling leaves no chart', async ({ page }) => {
  const before = await savedPatientCount(page)
  await signInAs(page, 'Attendant')
  await page.getByRole('button', { name: 'New walk-in', exact: true }).click()
  const registration = page.getByRole('dialog', { name: 'New walk-in patient' })

  await test.step('Lorna Padilla arrives with a child on her hip, and the name is still blank', async () => {
    await registration.getByLabel('Date of birth', { exact: true }).fill('1990-02-02')
    await registration.getByLabel(/^Sex/).selectOption('Female')
    await registration.getByLabel(/^Allergy status/).selectOption('none')
    await registration.getByRole('button', { name: 'Register patient' }).click()
    await expect(registration).toBeVisible()
    expect(await savedPatientCount(page)).toBe(before)
  })

  await test.step('A mistyped birth year is blocked by the date limit before anything is saved', async () => {
    await registration.getByLabel(/^Patient name/).fill('Lorna Padilla')
    await registration.getByLabel('Date of birth', { exact: true }).fill('2999-01-01')
    await registration.getByRole('button', { name: 'Register patient' }).click()
    await expect(registration).toBeVisible()
    expect(await savedPatientCount(page)).toBe(before)
  })

  await test.step('She decides to come back another day, so the desk cancels', async () => {
    await registration.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog', { name: 'New walk-in patient' })).toBeHidden()
    expect(await savedPatientCount(page)).toBe(before)
    expect(await page.evaluate(() => localStorage.getItem('northstar-demo-patients-v1')?.includes('Lorna Padilla'))).toBe(false)
  })
})

test('SRS 3: a patient cannot be booked into a slot that overlaps, but the slot right after is accepted and both survive reload', async ({ page }) => {
  await generateTodaysQr(page)
  await openChart(page, 'Paolo Mendoza')
  await page.getByRole('button', { name: 'Schedule', exact: true }).click()
  const booking = page.getByRole('dialog', { name: 'Book an appointment' })
  await expect(booking.locator('#appointment-patient option:checked')).toContainText('Paolo Mendoza')

  await test.step('Paolo asks for a review at 09:30, which Mateo Cruz already holds until 10:00', async () => {
    await booking.getByLabel(/^Start time/).selectOption('09:30')
    await booking.getByRole('button', { name: 'Confirm appointment' }).click()
    await expect(booking.getByRole('alert')).toContainText('That time overlaps an existing appointment')
    await expect(booking).toBeVisible()
  })

  await test.step('The front desk offers 10:00 instead, which starts when Mateo leaves and ends before Elena’s 10:30', async () => {
    await booking.getByLabel(/^Start time/).selectOption('10:00')
    await booking.getByRole('button', { name: 'Confirm appointment' }).click()
    await expect(booking).toBeHidden()
    await expect(page.locator('.upcoming-list .upcoming-row')).toHaveCount(6)
  })

  await test.step('After a reload, both of Paolo’s bookings are still on the calendar', async () => {
    await page.reload()
    await signInAs(page, 'Doctor')
    await navigate(page, /^Appointments$/)
    await expect(page.locator('.upcoming-list .upcoming-row')).toHaveCount(6)
    await expect(page.locator('.upcoming-list .upcoming-row').filter({ hasText: 'Paolo Mendoza' })).toHaveCount(2)
    await expect(page.locator('.upcoming-list .upcoming-row').filter({ hasText: 'Paolo Mendoza' }).filter({ hasText: '10:00 AM' })).toHaveCount(1)
  })
})

test('SRS 4: a patient who taps the link again keeps the same ticket, and the next patient gets the next number', async ({ page }) => {
  const before = await savedPatientCount(page)
  await generateTodaysQr(page)
  await signInAs(page, 'Patient')

  await test.step('Joy Villanueva checks in from her patient view and receives ticket R-001', async () => {
    await checkInAsPatient(page, { name: 'Joy Villanueva', phone: '0917 555 0175', birthDate: '1990-05-10' })
    await expect(page.getByRole('status')).toContainText('R-001')
    await page.getByRole('button', { name: 'Back to clinic' }).click()
  })

  await test.step('Her connection drops, so she taps the link again and types her name in lowercase', async () => {
    await checkInAsPatient(page, { name: 'joy villanueva', phone: '09175550175', birthDate: '1990-05-10' })
    await expect(page.getByRole('status')).toContainText('R-001')
    await page.getByRole('button', { name: 'Back to clinic' }).click()
  })

  await test.step('Noel Padilla checks in next and receives ticket R-002', async () => {
    await checkInAsPatient(page, { name: 'Noel Padilla', phone: '0917-555-0188', birthDate: '1988-03-14', sex: 'Male' })
    await expect(page.getByRole('status')).toContainText('R-002')
    await page.getByRole('button', { name: 'Back to clinic' }).click()
  })

  expect((await savedQueueEntries(page)).map((entry) => entry.number)).toEqual(['R-001', 'R-002'])
  expect(await savedPatientCount(page)).toBe(before + 2)
})

test('SRS 5: intake paused at lunch and a QR link from the morning create nothing, and the link fails the next day', async ({ page }) => {
  const before = await savedPatientCount(page)
  await generateTodaysQr(page)
  const morningLink = await currentCheckInLink(page)

  await test.step('Ana pauses intake for lunch', async () => {
    await signInAs(page, 'Attendant')
    await page.getByRole('button', { name: 'Pause check-in' }).click()
    await expect(page.getByText('Check-in paused', { exact: true }).first()).toBeVisible()
  })

  await test.step('A patient at the entrance cannot start check-in from her view', async () => {
    await signInAs(page, 'Patient')
    await expect(page.getByRole('button', { name: 'Open patient check-in' })).toBeDisabled()
  })

  await test.step('A patient who scans the morning QR is told check-in is paused, and nothing is created', async () => {
    await page.goto(morningLink)
    await expect(page.getByText('Check-in is paused', { exact: true })).toBeVisible()
    await expect(page.getByLabel(/^Full name/)).toHaveCount(0)
    expect(await savedPatientCount(page)).toBe(before)
    expect(await savedQueueEntries(page)).toHaveLength(0)
  })

  await test.step('After lunch Ana resumes intake, and the same morning link opens the form again', async () => {
    await page.getByRole('button', { name: 'Back to clinic' }).click()
    await signInAs(page, 'Attendant')
    await page.getByRole('button', { name: 'Resume check-in' }).click()
    await page.goto(morningLink)
    await expect(page.getByLabel(/^Full name/)).toBeVisible()
  })

  await test.step('On the next clinic day the same link is no longer connected to a session', async () => {
    await page.clock.setFixedTime(new Date('2026-11-10T01:00:00Z'))
    await page.goto(morningLink)
    await expect(page.getByRole('alert')).toContainText('This check-in link isn’t connected')
    await expect(page.getByRole('button', { name: 'Get my queue number' })).toHaveCount(0)
    expect(await savedPatientCount(page)).toBe(before)
  })
})

test('SRS 7: a later visit draft never rewrites an earlier saved visit, and an empty visit is refused', async ({ page }) => {
  // Mateo Cruz has no interview draft. Sofia Reyes starts with one, so saving her visit would not be empty.
  await page.getByRole('button', { name: 'Explore demo workspace' }).click()
  await openChart(page, 'Mateo Cruz')
  await page.getByRole('button', { name: 'Start visit', exact: true }).first().click()

  await test.step('Dr. Reyes tries to save before writing anything, and the app refuses', async () => {
    await page.getByRole('button', { name: 'Save visit to chart' }).click()
    await expect(page.getByText('Add a note, signs, symptoms, or diagnosis before saving.')).toBeVisible()
  })

  await test.step('She saves the cough follow-up, and it appears in the medical history', async () => {
    await page.getByLabel(/^Interview notes/).fill('First saved interview note')
    await page.getByLabel('Assessment / diagnosis').fill('First saved assessment')
    await page.getByRole('button', { name: 'Save visit to chart' }).click()
    await expect(page.getByRole('heading', { name: 'Medical history', exact: true })).toBeVisible()
    await expect(page.getByText('First saved interview note', { exact: true })).toBeVisible()
  })

  await test.step('A new draft for the next visit is typed, but not yet saved', async () => {
    await page.locator('.chart-tabs').getByRole('button', { name: /^Visit notes/ }).click()
    await page.getByLabel(/^Interview notes/).fill('Second draft interview note')
    await page.getByLabel('Assessment / diagnosis').fill('Second draft assessment')
    await page.locator('.chart-tabs').getByRole('button', { name: /^Medical history/ }).click()
  })

  await test.step('The saved history still shows only the first visit, unchanged', async () => {
    await expect(page.getByText('First saved interview note', { exact: true })).toBeVisible()
    await expect(page.getByText('First saved assessment', { exact: true })).toBeVisible()
    await expect(page.getByText('Second draft interview note')).toHaveCount(0)
    await expect(page.getByText('Second draft assessment')).toHaveCount(0)
  })
})

test('SRS 8: an unsaved draft stays with its own patient and never appears on another chart', async ({ page }) => {
  await page.getByRole('button', { name: 'Explore demo workspace' }).click()
  await openChart(page, 'Sofia Reyes')
  await page.getByRole('button', { name: 'Start visit', exact: true }).first().click()
  await page.getByLabel(/^Interview notes/).fill('Sofia only draft')
  await page.getByLabel('Assessment / diagnosis').fill('Sofia only assessment')

  await test.step('Dr. Reyes opens Mateo Cruz’s chart to start a visit, and nothing from Sofia’s draft appears', async () => {
    await openChart(page, 'Mateo Cruz')
    await page.getByRole('button', { name: 'Start visit', exact: true }).first().click()
    await expect(page.getByLabel(/^Interview notes/)).toHaveValue('')
    await expect(page.getByLabel('Assessment / diagnosis')).toHaveValue('')
  })

  await test.step('Back on Sofia’s chart, the interview note is kept but the unsaved assessment is not', async () => {
    await openChart(page, 'Sofia Reyes')
    await page.getByRole('button', { name: 'Start visit', exact: true }).first().click()
    await expect(page.getByLabel(/^Interview notes/)).toHaveValue('Sofia only draft')
    await expect(page.getByLabel('Assessment / diagnosis')).toHaveValue('')
  })
})

test('SRS 9: the printed prescription is labelled as a demo draft with the sample prescriber', async ({ page }) => {
  await page.getByRole('button', { name: 'Explore demo workspace' }).click()
  await openChart(page, 'Sofia Reyes')
  await page.locator('.chart-tabs').getByRole('button', { name: /^Prescriptions/ }).click()
  await page.getByLabel(/^Medication name/).fill('Cetirizine')
  await page.getByLabel(/^Strength/).fill('10 mg')
  await page.getByLabel('Directions for use').fill('One tablet by mouth at night, for sneezing')
  await page.getByRole('button', { name: 'Add to chart', exact: true }).click()
  await expect(page.locator('.prescription-list')).toContainText('Cetirizine')

  // The print preview is hidden on screen; emulate print to check exactly what would be printed.
  await page.emulateMedia({ media: 'print' })
  const printed = page.locator('#print-prescription')
  await expect(printed).toBeVisible()
  await expect(printed).toContainText('DEMO DRAFT — not a finalized prescription')
  await expect(printed).toContainText('Rx · DRAFT')
  await expect(printed).toContainText('Dr. Maya Reyes (sample clinician)')
  await expect(printed).toContainText('Sample identity · not authenticated')
  await expect(printed).toContainText('Sofia Reyes')
  await page.emulateMedia({ media: 'screen' })
})

test('ALL-01 and TRI-01: a documented allergy is removed only after the doctor records a clinical reason', async ({ page }) => {
  await generateTodaysQr(page)
  await signInAs(page, 'Patient')
  await test.step('Sofia Reyes, a returning patient, says she has no allergies at the QR check-in', async () => {
    await checkInAsPatient(page, { name: 'Sofia Reyes', phone: '0917-555-0142', birthDate: '1994-05-12', allergyStatus: 'none' })
    await expect(page.getByRole('status')).toContainText('R-001')
    await page.getByRole('button', { name: 'Back to clinic' }).click()
  })

  await test.step('Ana Santos triages her; the chart keeps its documented penicillin allergy and the difference goes to the doctor', async () => {
    await signInAs(page, 'Attendant')
    const dialog = await recordTriage(page, { complaint: 'Sneezing and blocked nose since Friday', allergy: 'none' })
    await expect(dialog).toContainText('Triage cannot remove a documented allergy')
    await dialog.getByRole('button', { name: 'Save triage & hand off' }).click()
    expect(await savedChart(page, 'Sofia Reyes')).toMatchObject({ allergyStatus: 'known', allergy: 'Penicillin' })
  })

  await test.step('Dr. Reyes reviews skin-test history with the patient, removes the allergy, and writes the reason', async () => {
    await signInAs(page, 'Doctor')
    await navigate(page, /^Daily queue/)
    await page.getByRole('button', { name: 'Start consultation' }).click()
    const visit = page.getByRole('dialog', { name: 'Complete visit' })
    await visit.getByLabel(/^Assessment \/ diagnosis/).fill('Allergic rhinitis, seasonal')
    await visit.getByLabel(/^Consultation notes/).fill('Penicillin allergy ruled out with the patient and her family physician.')
    await visit.getByRole('checkbox', { name: /reviewed the allergy information/ }).check()
    await visit.getByRole('radio', { name: /Remove documented allergy/ }).check()
    await expect(visit.getByRole('button', { name: 'Save visit to patient history' })).toBeDisabled()
    await visit.getByLabel(/^Reason for removing/).fill('Penicillin allergy ruled out by clinical history')
    await visit.getByRole('button', { name: 'Save visit to patient history' }).click()
    await expect(page.locator('.queue-table-row').filter({ hasText: 'Visit complete' })).toHaveCount(1)
  })

  await test.step('The chart now reads no known allergies, and the history records the reason', async () => {
    const chart = await savedChart(page, 'Sofia Reyes')
    expect(chart).toMatchObject({ allergyStatus: 'none', allergy: 'No known allergies' })
    expect(chart?.records[0].allergyReview).toEqual({ decision: 'removed', reportedStatus: 'none', documentedAllergy: 'Penicillin', reason: 'Penicillin allergy ruled out by clinical history' })
  })
})

test('a working day at Northstar Clinic: check-in, triage, a visit, a replaced QR and a lunch pause', async ({ page }) => {
  const baseline = await savedPatientCount(page)
  let printedLink = ''

  await test.step('08:00 Dr. Reyes opens the day and generates today’s QR code for the reception wall', async () => {
    await generateTodaysQr(page)
    printedLink = await currentCheckInLink(page)
  })

  await test.step('08:20 Sofia Reyes, a returning patient, checks in from her phone-style patient view and receives ticket R-001', async () => {
    await signInAs(page, 'Patient')
    await checkInAsPatient(page, { name: 'Sofia Reyes', phone: '0917-555-0142', birthDate: '1994-05-12', allergyStatus: 'none' })
    await expect(page.getByRole('status')).toContainText('R-001')
    await page.getByRole('button', { name: 'Back to clinic' }).click()
    expect(await savedPatientCount(page)).toBe(baseline)
  })

  await test.step('08:35 Ramon Dizon, a walk-in who is not sure of his allergies, checks in and receives ticket R-002', async () => {
    await checkInAsPatient(page, { name: 'Ramon Dizon', phone: '0917-555-0161', birthDate: '1979-08-21', sex: 'Male' })
    await expect(page.getByRole('status')).toContainText('R-002')
    await page.getByRole('button', { name: 'Back to clinic' }).click()
    expect(await savedPatientCount(page)).toBe(baseline + 1)
  })

  await test.step('08:45 Ana Santos triages Sofia: she reports no allergies, but the chart lists penicillin, so the chart keeps it', async () => {
    await signInAs(page, 'Attendant')
    const dialog = await recordTriage(page, { complaint: 'Sneezing and blocked nose since Friday', allergy: 'none' })
    await dialog.getByRole('button', { name: 'Save triage & hand off' }).click()
    expect(await savedChart(page, 'Sofia Reyes')).toMatchObject({ allergyStatus: 'known', allergy: 'Penicillin' })
  })

  await test.step('08:55 Ana triages Ramon: he now confirms a shellfish allergy, which is added to his chart', async () => {
    const dialog = await recordTriage(page, { complaint: 'Itchy rash on forearms after lunch', allergy: 'known', details: 'Shellfish' })
    await dialog.getByRole('button', { name: 'Save triage & hand off' }).click()
    expect(await savedChart(page, 'Ramon Dizon')).toMatchObject({ allergyStatus: 'known', allergy: 'Shellfish' })
  })

  await test.step('09:00 Dr. Reyes sees Sofia, keeps the documented penicillin allergy, and saves the visit', async () => {
    await signInAs(page, 'Doctor')
    await navigate(page, /^Daily queue/)
    await page.getByRole('button', { name: 'Start consultation' }).first().click()
    const visit = page.getByRole('dialog', { name: 'Complete visit' })
    await visit.getByLabel(/^Assessment \/ diagnosis/).fill('Allergic rhinitis, seasonal')
    await visit.getByLabel(/^Consultation notes/).fill('Symptoms since Friday. Patient reports no allergies. Chart keeps penicillin until reviewed.')
    await visit.getByRole('checkbox', { name: /reviewed the allergy information/ }).check()
    await visit.getByRole('radio', { name: /Keep documented allergy/ }).check()
    await visit.getByRole('button', { name: 'Save visit to patient history' }).click()
    await expect(page.locator('.queue-table-row').filter({ hasText: 'Visit complete' })).toHaveCount(1)
    const chart = await savedChart(page, 'Sofia Reyes')
    expect(chart).toMatchObject({ allergyStatus: 'known', allergy: 'Penicillin' })
    expect(chart?.records[0].allergyReview).toMatchObject({ decision: 'kept', documentedAllergy: 'Penicillin' })
  })

  await test.step('09:05 The printed QR is photographed and shared in a family chat, so Dr. Reyes replaces the code', async () => {
    await page.getByRole('button', { name: 'Rotate QR' }).click()
    await page.getByRole('button', { name: 'Replace QR code' }).click()
    await expect(page.locator('.toast')).toContainText('The previous code no longer works')
  })

  await test.step('09:06 Someone who opens the old photograph is turned away, and today’s tickets are untouched', async () => {
    await page.goto(printedLink)
    await expect(page.getByRole('alert')).toContainText('This check-in link isn’t connected')
    expect((await savedQueueEntries(page)).map((entry) => entry.number)).toEqual(['R-001', 'R-002'])
  })

  await test.step('12:00 Ana pauses intake for lunch, and a patient with the new code is told check-in is paused', async () => {
    await page.getByRole('button', { name: 'Back to clinic' }).click()
    await signInAs(page, 'Attendant')
    await page.getByRole('button', { name: 'Pause check-in' }).click()
    await expect(page.getByText('Check-in paused', { exact: true }).first()).toBeVisible()
    await page.goto(await currentCheckInLink(page))
    await expect(page.getByText('Check-in is paused', { exact: true })).toBeVisible()
    await expect(page.getByLabel(/^Full name/)).toHaveCount(0)
  })

  await test.step('13:00 Ana resumes intake, and Carmen Bautista checks in after lunch as ticket 003', async () => {
    await page.getByRole('button', { name: 'Back to clinic' }).click()
    await signInAs(page, 'Attendant')
    await page.getByRole('button', { name: 'Resume check-in' }).click()
    // A patient scans the new code on their own phone; the link is all they need.
    await page.goto(await currentCheckInLink(page))
    await expect(page.getByLabel(/^Full name/)).toBeVisible()
    await page.getByLabel(/^Full name/).fill('Carmen Bautista')
    await page.getByLabel(/^Phone number/).fill('0917-555-0199')
    await page.getByLabel(/^Date of birth/).fill('1968-11-02')
    await page.getByLabel(/^Sex/).selectOption('Female')
    await page.getByRole('button', { name: 'Get my queue number' }).click()
    await expect(page.getByRole('status')).toContainText('003')
  })

  await test.step('End of day: the three tickets keep their order, and the charts match what was recorded', async () => {
    expect((await savedQueueEntries(page)).map((entry) => entry.number)).toEqual(['R-001', 'R-002', 'R-003'])
    expect(await savedPatientCount(page)).toBe(baseline + 2)
    expect(await savedChart(page, 'Ramon Dizon')).toMatchObject({ allergyStatus: 'known', allergy: 'Shellfish' })
  })
})
