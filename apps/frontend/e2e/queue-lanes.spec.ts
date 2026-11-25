import { checkInAsPatient, expect, navigate, savedQueueEntries, signInAs, test } from './support'

// Seniors and pediatric patients share a priority lane; adults use the regular lane. The clinic has one doctor, so
// Dr. Reyes sees one list with the priority lane first. Every patient and staff member is synthetic.

test('a senior who arrives after an adult is called first, and each patient sees where they stand', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-09T01:00:00Z'))
  await page.goto('/')

  await test.step('08:00 Dr. Reyes opens today’s intake', async () => {
    await page.getByRole('button', { name: 'Explore demo workspace' }).click()
    await navigate(page, /^Daily queue/)
    await page.getByRole('button', { name: 'Generate today’s QR' }).click()
    await expect(page.getByRole('img', { name: 'QR code for today’s patient check-in', exact: true })).toBeVisible()
  })

  await test.step('08:05 Marco Dizon, an adult, checks in first and is the next patient', async () => {
    await signInAs(page, 'Patient')
    await checkInAsPatient(page, { name: 'Marco Dizon', phone: '0917-555-0201', birthDate: '1988-02-14' })
    const board = page.getByLabel('Queue status')
    await expect(page.getByRole('status')).toContainText('R-001')
    await expect(board).toContainText('Regular (adult)')
    await expect(board).toContainText('You are next.')
    await page.getByRole('button', { name: 'Back to clinic' }).click()
  })

  await test.step('08:10 Lola Remedios, a senior, checks in second and is put ahead of the adult', async () => {
    await signInAs(page, 'Patient')
    await checkInAsPatient(page, { name: 'Lola Remedios', phone: '0917-555-0202', birthDate: '1951-09-03' })
    const board = page.getByLabel('Queue status')
    await expect(page.getByRole('status')).toContainText('P-001')
    await expect(board).toContainText('Priority (senior & pediatric)')
    await expect(board).toContainText('You are next.')
    await page.getByRole('button', { name: 'Back to clinic' }).click()
  })

  await test.step('08:12 a child, Paolo Dizon, joins the same priority lane behind the senior', async () => {
    await signInAs(page, 'Patient')
    await checkInAsPatient(page, { name: 'Paolo Dizon', phone: '0917-555-0203', birthDate: '2017-06-21', sex: 'Male' })
    await expect(page.getByRole('status')).toContainText('P-002')
    await expect(page.getByLabel('Queue status')).toContainText('1 person is ahead of you.')
    await page.getByRole('button', { name: 'Back to clinic' }).click()
  })

  await test.step('Any patient can see the current number and how many are waiting, but no names', async () => {
    await signInAs(page, 'Patient')
    const summary = page.getByLabel('Today’s queue')
    await expect(summary).toContainText('3 waiting')
    await expect(summary).toContainText('No one yet')
    await expect(summary).not.toContainText('Lola')
  })

  await test.step('Dr. Reyes sees the senior and the child above the adult, and Call next follows that order', async () => {
    await signInAs(page, 'Doctor')
    await navigate(page, /^Daily queue/)
    const rows = page.locator('.queue-table-row')
    await expect(rows.nth(0)).toContainText('Lola Remedios')
    await expect(rows.nth(0)).toContainText('Senior')
    await expect(rows.nth(1)).toContainText('Paolo Dizon')
    await expect(rows.nth(1)).toContainText('Pediatric')
    await expect(rows.nth(2)).toContainText('Marco Dizon')
    await page.getByRole('button', { name: 'Call next', exact: true }).click()
    expect((await savedQueueEntries(page)).map((entry) => [entry.number, entry.status])).toEqual([['R-001', 'waiting'], ['P-001', 'called'], ['P-002', 'waiting']])
  })

  await test.step('The patient view now shows the senior’s number as the one being served', async () => {
    await signInAs(page, 'Patient')
    await expect(page.getByLabel('Today’s queue')).toContainText('Now serving: P-001')
  })
})
