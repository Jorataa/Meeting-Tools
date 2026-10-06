import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const meetingContext = {
  summary: 'Jovan will deploy the landing page on Friday.', topics: ['Launch'],
  decisions: ['Launch Friday'], actionItems: ['Deploy landing page'],
  unresolvedQuestions: ['Who reviews the copy?'],
  structuredActionItems: [{ task: 'Deploy landing page', owner: 'Jovan', deadline: 'Friday' }],
  deadlines: ['Friday: landing page launch'], people: ['Jovan'], resolvedQuestions: [],
};
const initialNotes = 'Jovan will deploy the landing page on Friday.';

async function setupDemo(page: Page) {
  await page.route('**/api/auth', route => route.fulfill({ json: { mode: 'demo', user: null } }));
  await page.route('**/api/session', route => route.fulfill({ json: { ai: true } }));
  await page.route('**/api/transcribe', route => route.fulfill({ json: { transcript: initialNotes } }));
  await page.route('**/api/interruption', route => route.fulfill({ json: {
    shouldInterrupt: false, confidence: 0, category: 'none', question: '', reason: '', gapKey: '', notes: initialNotes, context: meetingContext,
  } }));
}
async function completeUpload(page: Page) {
  await page.goto('/');
  await page.getByLabel('Choose audio file').setInputFiles(path.resolve('tests/fixtures/english.wav'));
  await page.getByRole('button', { name: 'Transcribe audio', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Meeting transcript', exact: true })).toHaveValue(initialNotes);
  await expect(page.getByRole('region', { name: 'Meeting notes', exact: true })).toContainText(initialNotes);
}

test('manual questions use edited notes and render untrusted AI output as text', async ({ page }) => {
  await setupDemo(page);
  let asked: Record<string, unknown> | undefined;
  const answer = '<img src=x onerror="window.aiExecuted=true"> Jovan owns the Friday deployment.';
  await page.route('**/api/ask', async route => {
    asked = route.request().postDataJSON();
    await route.fulfill({ json: { answer } });
  });
  await completeUpload(page);
  await page.getByRole('button', { name: 'Edit meeting notes', exact: true }).click();
  const revisedNotes = 'Jovan deploys Friday. Rina reviews the copy Thursday.';
  await page.getByRole('textbox', { name: 'Edit meeting notes', exact: true }).fill(revisedNotes);
  await page.getByRole('button', { name: 'Done editing', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('hush.meetings.v1') || '[]')[0]?.notes)).toBe(revisedNotes);

  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export notes', exact: true }).click();
  const exported = await downloadEvent;
  expect(exported.suggestedFilename()).toBe('meeting-notes.txt');
  expect(await readFile((await exported.path())!, 'utf8')).toBe(revisedNotes);

  await page.getByRole('textbox', { name: 'Ask about this meeting', exact: true }).fill('Who owns deployment?');
  await page.getByRole('button', { name: 'Ask about this meeting', exact: true }).click();
  const assistant = page.getByRole('region', { name: 'Ask Hush', exact: true });
  await expect(assistant).toContainText(answer);
  expect(asked?.notes).toBe(revisedNotes);
  expect(asked?.transcript).toBe(initialNotes);
  await expect(assistant.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => 'aiExecuted' in window)).toBe(false);
  await expect(page.getByRole('region', { name: 'Action items', exact: true })).toContainText('Jovan · Friday');
});

test('session retention and confirmed deletion provide clear privacy control', async ({ page }) => {
  await setupDemo(page);
  await completeUpload(page);
  await page.getByRole('button', { name: 'Delete meeting', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Meeting transcript', exact: true })).toHaveValue(initialNotes);
  await page.getByRole('button', { name: 'Keep meeting', exact: true }).click();
  const nav = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  await nav.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Meeting retention', exact: true }).selectOption('session');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('hush.meetings.v1'))).toBeNull();
  await expect(page.getByRole('region', { name: 'Workspace settings', exact: true })).toContainText('Reloading or closing this page removes session meetings.');
  await page.getByRole('button', { name: 'Delete all saved meetings', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete all meetings', exact: true }).click();
  await nav.getByRole('button', { name: /^Meetings/ }).click();
  await expect(page.getByRole('heading', { name: 'Your conversations belong here.', exact: true })).toBeVisible();
});

test('account deletion failure keeps the meeting visible until deletion succeeds', async ({ page }) => {
  const user = { id: '86ef55e4-780f-49e2-8d84-92050395ec64', email: 'member@example.test' };
  const document = { id: 'ac1c1d3b-a313-46fc-bac6-44bf73c6b4ef', title: 'Friday launch', transcript: initialNotes, notes: initialNotes, context: meetingContext, date: Date.now(), elapsed: 25 };
  await page.route('**/api/auth', route => route.fulfill({ json: { mode: 'supabase', user } }));
  let failDelete = true;
  await page.route('**/api/meetings', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { meetings: [document] } });
    if (route.request().method() === 'DELETE' && failDelete) return route.fulfill({ status: 503, json: { error: 'Please retry.' } });
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('button', { name: /^Meetings/ }).click();
  await page.getByRole('region', { name: 'Saved meetings', exact: true }).getByRole('button', { name: /Friday launch/ }).click();
  await page.getByRole('button', { name: 'Delete meeting', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete meeting', exact: true }).click();
  await expect(page.getByText('The meeting could not be deleted from your account. Please retry.', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Meeting transcript', exact: true })).toHaveValue(initialNotes);
  failDelete = false;
  await page.getByRole('button', { name: 'Confirm delete meeting', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start recording', exact: true })).toBeVisible();
});

test('action item approval, question resolution, and personalization settings work smoothly', async ({ page }) => {
  await setupDemo(page);
  await completeUpload(page);

  // Phase 3: Action item explicit approval
  const actionItemsRegion = page.getByRole('region', { name: 'Action items', exact: true });
  await expect(actionItemsRegion).toBeVisible();
  const approveBtn = actionItemsRegion.getByRole('button', { name: 'Approve', exact: true });
  await expect(approveBtn).toBeVisible();
  await approveBtn.click();
  await expect(actionItemsRegion.getByText('Approved')).toBeVisible();

  // Phase 3: Question resolution
  const unresolvedRegion = page.getByRole('region', { name: 'Unresolved questions', exact: true });
  await expect(unresolvedRegion).toContainText('Who reviews the copy?');
  const resolveBtn = unresolvedRegion.getByRole('button', { name: 'Resolve', exact: true });
  await expect(resolveBtn).toBeVisible();
  await resolveBtn.click();
  await expect(unresolvedRegion).not.toBeVisible();
  await expect(page.getByText('Resolved questions · 1')).toBeVisible();

  // Phase 4: Personalization preferences in Settings
  const nav = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  await nav.getByRole('button', { name: 'Settings', exact: true }).click();

  const freqSelect = page.getByLabel('Clarification frequency');
  await expect(freqSelect).toHaveValue('balanced');
  await freqSelect.selectOption('minimal');
  await expect(freqSelect).toHaveValue('minimal');

  const langSelect = page.getByLabel('Meeting language');
  await expect(langSelect).toHaveValue('auto');
  await langSelect.selectOption('id');
  await expect(langSelect).toHaveValue('id');

  const styleSelect = page.getByLabel('Notes style');
  await expect(styleSelect).toHaveValue('concise');
  await styleSelect.selectOption('structured');
  await expect(styleSelect).toHaveValue('structured');

  // Verify persistence
  const savedPrefs = await page.evaluate(() => JSON.parse(localStorage.getItem('hush.prefs.demo') || '{}'));
  expect(savedPrefs.frequency).toBe('minimal');
  expect(savedPrefs.language).toBe('id');
  expect(savedPrefs.summaryStyle).toBe('structured');

  // Responsive verification
  await page.setViewportSize({ width: 390, height: 844 });
  const hasHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(hasHorizontalScroll).toBe(false);

  await page.setViewportSize({ width: 768, height: 1024 });
  const tabletScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(tabletScroll).toBe(false);
});

test('reloading the page restores the active meeting session and displays notice', async ({ page }) => {
  await setupDemo(page);
  await completeUpload(page);

  // Reload the page
  await page.reload();

  // Verify restored notice appears
  await expect(page.locator('.restored-notice')).toHaveText('Meeting restored');

  // Verify meeting title and transcript are preserved
  await expect(page.getByRole('textbox', { name: 'Meeting transcript', exact: true })).toHaveValue(initialNotes);
  await expect(page.getByRole('region', { name: 'Meeting notes', exact: true })).toContainText(initialNotes);

  // Clicking "New transcription" resets session storage so reload would not restore
  await page.getByRole('button', { name: 'New transcription', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start recording', exact: true })).toBeVisible();

  // Reload again -> should stay on initial screen (not restore)
  await page.reload();
  await expect(page.getByRole('button', { name: 'Start recording', exact: true })).toBeVisible();
  await expect(page.locator('.restored-notice')).not.toBeVisible();
});

