import { checkInAsPatient, expect, navigate, savedChart, savedPatientCount, savedQueueEntries, signInAs, test, type Page } from './support'

// The daily QR session: the doctor sets a closing time, ends or reopens the day, and what a patient says at check-in
// reaches reception and the doctor. Like the other browser journeys, every patient and staff member is synthetic.

async function generateTodaysQr(page: Page, closesAt?: string) {
  await page.getByRole('button', { name: 'Explore demo workspace' }).click()
  await navigate(page, /^Daily queue/)
  if (closesAt) await page.getByRole('combobox', { name: /Check-in closes at/ }).selectOption(closesAt)
  await page.getByRole('button', { name: 'Generate today’s QR' }).click()
  await expect(page.getByRole('img', { name: 'QR code for today’s patient check-in', exact: true })).toBeVisible()
}

test('check-in closes at the closing time the doctor set, even while a patient is still filling in the form', async ({ page }) => {
  // The clock runs normally from 09:00 in Manila, so the closing time can pass while the page stays open.
  await page.clock.install({ time: new Date('2026-11-09T01:00:00Z') })
  await page.goto('/')
  const before = await savedPatientCount(page)

  await test.step('09:00 Dr. Reyes generates the QR and sets check-in to close at 17:00', async () => {
    await generateTodaysQr(page, '17:00')
    await expect(page.locator('.queue-open-badge')).toContainText('Accepting check-ins')
  })

  await test.step('16:58 A patient opens the form from her patient view and starts typing', async () => {
    await page.clock.runFor(7 * 60 * 60 * 1000 + 58 * 60 * 1000)
    await signInAs(page, 'Patient')
    await page.getByRole('button', { name: 'Open patient check-in' }).click()
    await page.getByLabel(/^Full name/).fill('Teresita Salazar')
    await page.getByLabel(/^Phone number/).fill('0917-555-0131')
    await page.getByLabel(/^Date of birth/).fill('1961-04-19')
    await page.getByLabel(/^Sex/).selectOption('Female')
  })

  await test.step('17:01 The closing time passes, and the form is replaced by the closed notice without anyone pressing a button', async () => {
    await page.clock.runFor(3 * 60 * 1000)
    await expect(page.getByRole('status')).toContainText('Check-in closed at 17:00')
    await expect(page.getByLabel(/^Full name/)).toHaveCount(0)
    expect(await savedQueueEntries(page)).toHaveLength(0)
    expect(await savedPatientCount(page)).toBe(before)
  })

  await test.step('Dr. Reyes sees the day marked as closed at 17:00 on the queue page', async () => {
    await page.getByRole('button', { name: 'Back to clinic' }).click()
    await signInAs(page, 'Doctor')
    await navigate(page, /^Daily queue/)
    await expect(page.locator('.queue-open-badge')).toContainText('Closed at 17:00')
  })
})

test('what a patient writes at check-in goes straight to the doctor, in the patient’s own words, without triage', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-09T01:00:00Z'))
  await page.goto('/')
  const reason = 'Headache since yesterday'
  const symptoms = 'Throbbing behind the eyes, worse with screen time, no fever. Paracetamol helped a little.'

  await test.step('08:20 Teresita Salazar checks in from her patient view, and describes her headache in her own words', async () => {
    await generateTodaysQr(page)
    await signInAs(page, 'Patient')
    await checkInAsPatient(page, { name: 'Teresita Salazar', phone: '0917-555-0131', birthDate: '1961-04-19', reason, symptoms })
    await expect(page.getByRole('status')).toContainText('P-001')
    await page.getByRole('button', { name: 'Back to clinic' }).click()
    expect((await savedQueueEntries(page))[0]).toMatchObject({ number: 'P-001', stage: 'ready' })
  })

  await test.step('08:40 Ana Santos sees her waiting for the doctor; recording triage is optional and not needed', async () => {
    await signInAs(page, 'Attendant')
    await expect(page.locator('.role-demo-queue-list')).toContainText('Waiting for doctor')
  })

  await test.step('09:00 Dr. Reyes starts the visit, and the symptoms field already holds what the patient wrote', async () => {
    await signInAs(page, 'Doctor')
    await navigate(page, /^Daily queue/)
    await page.getByRole('button', { name: 'Start consultation' }).click()
    const visit = page.getByRole('dialog', { name: 'Complete visit' })
    await expect(visit.getByRole('textbox', { name: 'Symptoms' })).toHaveValue(symptoms)
    await expect(visit).toContainText(reason)
    await visit.getByLabel(/^Confirmed allergy status/).selectOption('none')
    await visit.getByLabel(/^Assessment \/ diagnosis/).fill('Tension-type headache')
    await visit.getByLabel(/^Consultation notes/).fill('Discussed screen breaks and hydration. Review if fever or vision changes develop.')
    await visit.getByRole('checkbox', { name: /reviewed the allergy information/ }).check()
    await visit.getByRole('button', { name: 'Save visit to patient history' }).click()
    await expect(page.locator('.queue-table-row').first()).toContainText('Visit complete')
  })

  await test.step('The saved history keeps the symptoms in the words that were used at the visit', async () => {
    const chart = await savedChart(page, 'Teresita Salazar')
    expect(chart?.records[0]).toMatchObject({ diagnosis: 'Tension-type headache', symptoms })
  })
})

test('the doctor can end the day’s intake, turning patients away, and only the doctor can reopen it', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-09T01:00:00Z'))
  await page.goto('/')

  await test.step('12:30 Dr. Reyes ends intake early, because she is called to a hospital round', async () => {
    await generateTodaysQr(page)
    await page.getByRole('button', { name: 'End today’s intake' }).click()
    await page.getByRole('button', { name: 'End intake for today' }).click()
    await expect(page.locator('.queue-open-badge')).toContainText('Intake ended for today')
  })

  await test.step('Ana Santos can see that intake is closed, but has no control to reopen it', async () => {
    await signInAs(page, 'Attendant')
    await expect(page.getByText('Intake is closed for today. Only the doctor can reopen it.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /Resume check-in|Pause check-in|Reopen intake/ })).toHaveCount(0)
  })

  await test.step('A patient at the entrance cannot start check-in', async () => {
    await signInAs(page, 'Patient')
    await expect(page.getByRole('button', { name: 'Open patient check-in' })).toBeDisabled()
  })

  await test.step('Dr. Reyes returns and reopens intake, and check-in is available again', async () => {
    await signInAs(page, 'Doctor')
    await navigate(page, /^Daily queue/)
    await page.getByRole('button', { name: 'Reopen intake' }).click()
    await expect(page.locator('.queue-open-badge')).toContainText('Accepting check-ins')
    await signInAs(page, 'Patient')
    await expect(page.getByRole('button', { name: 'Open patient check-in' })).toBeEnabled()
  })
})
