import { test, expect } from '@playwright/test';
import { emitTranscript, mockLiveStream } from './helpers/live-stream';

test.beforeEach(async ({ page }) => {
  await mockLiveStream(page);
  await page.route('**/api/session', route => route.fulfill({ json: { ai: true } }));
  await page.route('**/api/interruption', route => route.fulfill({ json: { shouldInterrupt: false, confidence: 0, category: 'none', question: '', reason: '', gapKey: '', notes: '' } }));
  await page.route('**/api/transcribe', route => route.fulfill({ json: { transcript: 'Today we need to finish the landing page. Then publish it Friday.' } }));
});

test('words visibly grow before Stop, final replay is deduplicated, and paused microphone resumes', async ({ page, context }) => {
  await context.grantPermissions(['microphone']);
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => {
      const stream = await original(options);
      (window as unknown as { capturedStream: MediaStream }).capturedStream = stream;
      return stream;
    };
  });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  const transcript = page.getByRole('region', { name: 'Live transcript', exact: true });
  for (const text of ['Today', 'Today we need', 'Today we need to finish', 'Today we need to finish the landing page.']) {
    await emitTranscript(page, 'partial', text);
    await expect(transcript).toContainText(text);
    await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible();
  }
  await emitTranscript(page, 'final', 'Today we need to finish the landing page.');
  await emitTranscript(page, 'final', 'Today we need to finish the landing page.');
  expect((await transcript.innerText()).match(/Today we need to finish the landing page\./g)).toHaveLength(1);
  await emitTranscript(page, 'partial', 'Then publish');
  await emitTranscript(page, 'final', 'Today we need to finish the landing page.');
  await expect(transcript).toContainText('Today we need to finish the landing page.');
  await expect(transcript).toContainText('Then publish');
  await expect.poll(() => page.evaluate(() => (window as unknown as { testLive: { frames: number } }).testLive.frames)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as unknown as { testLive: { nonzero: boolean } }).testLive.nonzero)).toBe(true);
  await page.getByRole('button', { name: 'Pause recording', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { capturedStream: MediaStream }).capturedStream.getAudioTracks().every(track => !track.enabled))).toBe(true);
  const elapsed = await page.locator('.recording-time').innerText();
  await page.waitForTimeout(1100); await expect(page.locator('.recording-time')).toHaveText(elapsed);
  await page.getByRole('button', { name: 'Resume recording', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { capturedStream: MediaStream }).capturedStream.getAudioTracks().every(track => track.enabled))).toBe(true);
  await emitTranscript(page, 'final', 'Then publish it Friday.', 'test-final-2');
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Meeting transcript', exact: true })).toHaveValue('Today we need to finish the landing page. Then publish it Friday.');
  expect(await page.evaluate(() => (window as unknown as { capturedStream: MediaStream }).capturedStream.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
  expect(errors).toEqual([]);
});

test('finalizing keeps the live transcript readable while the full recording is reconciled', async ({ page, context }) => {
  await context.grantPermissions(['microphone']);
  let finish!: () => void;
  await page.route('**/api/transcribe', async route => {
    await new Promise<void>(resolve => { finish = resolve; });
    await route.fulfill({ json: { transcript: 'Retained words.' } });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await emitTranscript(page, 'partial', 'Retained words.');
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Live transcript', exact: true })).toContainText('Retained words.');
  await expect.poll(() => !!finish).toBe(true); finish();
  await expect(page.getByRole('textbox', { name: 'Meeting transcript', exact: true })).toHaveValue('Retained words.');
});
