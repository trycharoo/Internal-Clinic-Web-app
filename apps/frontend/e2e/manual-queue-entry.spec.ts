import { expect, navigate, savedQueueEntries, signInAs, test } from './support'

// Fallback when the QR cannot be used: the attendant and the doctor can both add a patient by hand, even after intake
// has closed. An urgent patient is called before everyone else. Every patient and staff member is synthetic.

test('the attendant adds an urgent patient after intake has ended, and the doctor sees that patient first', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-09T01:00:00Z'))
  await page.goto('/')

  await test.step('Dr. Reyes opens today’s intake, then ends it for the day', async () => {
    await page.getByRole('button', { name: 'Explore demo workspace' }).click()
    await navigate(page, /^Daily queue/)
    await page.getByRole('button', { name: 'Generate today’s QR' }).click()
    await page.getByRole('button', { name: 'End today’s intake' }).click()
    await page.getByRole('button', { name: 'End intake for today' }).click()
    await expect(page.getByText('Intake ended for today').first()).toBeVisible()
  })

  await test.step('The attendant adds a patient who cannot use the QR, flagged urgent', async () => {
    await signInAs(page, 'Attendant')
    await page.getByRole('button', { name: 'Add to queue' }).click()
    const dialog = page.getByRole('dialog', { name: /Add patient to today’s queue/ })
    await dialog.getByRole('checkbox', { name: /Urgent or emergency/ }).check()
    await dialog.getByLabel(/^Patient name/).fill('Ramon Villanueva')
    await dialog.getByLabel('Date of birth').fill('1979-04-12')
    await dialog.getByLabel(/^Sex/).selectOption('Male')
    await dialog.getByLabel(/^Why is this urgent/).fill('Chest pain and sweating')
    await dialog.getByRole('button', { name: 'Add as urgent' }).click()
    await expect(page.getByRole('region', { name: /Today’s reception queue/ })).toContainText('U-001')
    const [ticket] = await savedQueueEntries(page)
    expect(ticket).toMatchObject({ number: 'U-001', status: 'waiting', stage: 'ready' })
  })

  await test.step('The doctor sees the urgent ticket, with the reason, at the top of the list', async () => {
    await signInAs(page, 'Doctor')
    await navigate(page, /^Daily queue/)
    const rows = page.locator('.queue-table-row')
    await expect(rows.nth(0)).toContainText('Ramon Villanueva')
    await expect(rows.nth(0)).toContainText('Urgent')
    await expect(rows.nth(0)).toContainText('Added by attendant')
    await expect(rows.nth(0)).toContainText('Chest pain and sweating')
  })

  await test.step('The doctor adds a second patient by hand, and Call next still picks the urgent one', async () => {
    await page.getByRole('button', { name: 'Add patient manually' }).click()
    const dialog = page.getByRole('dialog', { name: /Add patient to today’s queue/ })
    await dialog.getByLabel(/^Patient name/).fill('Lourdes Ocampo')
    await dialog.getByLabel('Date of birth').fill('1949-01-30')
    await dialog.getByLabel(/^Sex/).selectOption('Female')
    await dialog.getByRole('button', { name: 'Add to queue' }).click()
    await expect(page.locator('.queue-table-row').nth(1)).toContainText('Lourdes Ocampo')
    await page.getByRole('button', { name: 'Call next', exact: true }).click()
    expect((await savedQueueEntries(page)).map((entry) => [entry.number, entry.status])).toEqual([['U-001', 'called'], ['P-001', 'waiting']])
  })
})
