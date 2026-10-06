import { test, expect } from '@playwright/test';
import path from 'node:path';
import { emitTranscript, mockLiveStream } from './helpers/live-stream';

const context = {
  summary: 'The landing page launch is scheduled for Friday.',
  topics: ['Landing page', 'Launch'], decisions: ['Launch Friday'],
  actionItems: ['Rina: publish the landing page'], unresolvedQuestions: ['Who reviews the copy?'],
};
const notes = 'Launch Friday. Rina will publish the landing page.';

test.beforeEach(async ({ page }) => {
  await mockLiveStream(page);
  await page.route('**/api/session', route => route.fulfill({ json: { ai: true } }));
  await page.route('**/api/interruption', route => route.fulfill({ json: {
    shouldInterrupt: false, confidence: 0, category: 'none', question: '', reason: '', gapKey: '', notes, context,
  } }));
});

test('completed uploads save editable history, notes, and searchable meeting content', async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/transcribe', route => route.fulfill({ json: { transcript: 'Rina will publish the landing page on Friday.' } }));
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Meeting title', exact: true }).fill('Launch planning');
  await page.getByLabel('Choose audio file').setInputFiles(path.resolve('tests/fixtures/english.wav'));
  await page.getByRole('button', { name: 'Transcribe audio', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Meeting transcript', exact: true })).toHaveValue('Rina will publish the landing page on Friday.');
  await expect(page.getByRole('region', { name: 'Meeting notes', exact: true })).toContainText(notes);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('hush.meetings.v1') || '[]').length)).toBe(1);

  const nav = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  await nav.getByRole('button', { name: 'Notes', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Saved meetings', exact: true })).toContainText(notes);
  await nav.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search meetings', exact: true }).fill('Rina');
  const library = page.getByRole('region', { name: 'Saved meetings', exact: true });
  await expect(library.getByRole('button', { name: /Launch planning/ })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search meetings', exact: true }).fill('missing unicorn');
  await expect(page.getByRole('heading', { name: 'No matching meetings', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search meetings', exact: true }).fill('Friday');
  await library.getByRole('button', { name: /Launch planning/ }).click();
  await page.getByRole('textbox', { name: 'Meeting title', exact: true }).fill('Launch review');
  await page.getByRole('textbox', { name: 'Meeting transcript', exact: true }).fill('Rina confirmed the Friday launch.');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('hush.meetings.v1') || '[]')[0]?.transcript)).toBe('Rina confirmed the Friday launch.');
  await page.reload();
  await nav.getByRole('button', { name: /^Meetings/ }).click();
  await page.getByRole('region', { name: 'Saved meetings', exact: true }).getByRole('button', { name: /Launch review/ }).click();
  await expect(page.getByRole('textbox', { name: 'Meeting transcript', exact: true })).toHaveValue('Rina confirmed the Friday launch.');
  await expect(page.getByRole('region', { name: 'Meeting summary', exact: true })).toContainText(context.summary);
  expect(errors).toEqual([]);
});

test('mobile context panel and navigation preserve an active microphone and growing transcript', async ({ page, context: browserContext }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 });
  await browserContext.grantPermissions(['microphone']);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible();
  await emitTranscript(page, 'partial', 'Today we need to launch');
  await expect(page.getByRole('region', { name: 'Live transcript', exact: true })).toContainText('Today we need to launch');
  await expect(page.getByRole('button', { name: 'New Meeting', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: 'Context & notes', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Meeting context', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible();
  await emitTranscript(page, 'partial', 'Today we need to launch on Friday');
  await page.getByRole('tab', { name: 'Transcript', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Live transcript', exact: true })).toContainText('Today we need to launch on Friday');
  const nav = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  await nav.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('region', { name: 'Workspace settings', exact: true });
  await expect(settings).toContainText('Your recording continues.');
  await settings.getByRole('button', { name: 'AI Voice: ON', exact: true }).click();
  await expect(settings.getByRole('button', { name: 'AI Voice: OFF', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await nav.getByRole('button', { name: 'Workspace', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Live transcript', exact: true })).toContainText('Today we need to launch on Friday');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Cancel recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New Meeting', exact: true })).toBeEnabled();
});

test('malformed stored history does not prevent starting a new meeting', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('hush.meetings.v1', '{invalid JSON'));
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start recording', exact: true })).toBeVisible();
  await expect(page.getByText('Meeting history is unavailable.', { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});
