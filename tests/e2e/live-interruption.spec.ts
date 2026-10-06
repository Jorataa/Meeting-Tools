import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('live Gemini interruption: real audio, clarification voice, participant answer and updated notes', async ({ page }) => {
  test.skip(process.env.RUN_LIVE_GEMINI !== '1', 'Requires configured server keys; makes real Gemini requests.');
  test.setTimeout(150000);
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext(); await context.resume();
      const destination = context.createMediaStreamDestination();
      // Keep the stream alive through silent natural pauses.
      const oscillator = context.createOscillator(), silence = context.createGain(); silence.gain.value = 0;
      oscillator.connect(silence); silence.connect(destination); oscillator.start();
      (window as unknown as { playParticipant: (encoded: string) => Promise<void> }).playParticipant = async encoded => {
        const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
        const audio = await context.decodeAudioData(bytes.buffer);
        const source = context.createBufferSource(); source.buffer = audio; source.connect(destination);
        await new Promise<void>(resolve => { source.onended = () => resolve(); source.start(); });
      };
      return destination.stream;
    };
  });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let questionResponses = 0, voiceSuccess = false;
  page.on('response', response => {
    if (response.url().endsWith('/api/interruption')) questionResponses++;
    if (response.url().endsWith('/api/voice') && response.status() === 200) voiceSuccess = true;
  });
  const play = async (file: string) => {
    const encoded = (await readFile(path.resolve('tests/fixtures', file))).toString('base64');
    await page.evaluate(encoded => (window as unknown as { playParticipant: (encoded: string) => Promise<void> }).playParticipant(encoded), encoded);
  };
  await page.goto('/'); await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible();
  await play('deadline.mp3');
  const transcript = page.getByRole('region', { name: 'Live transcript', exact: true });
  await expect(transcript).toContainText('Hush:', { timeout: 65000 });
  await expect(page.getByText('AI is asking a question…')).not.toBeVisible({ timeout: 25000 });
  expect(voiceSuccess).toBe(true);
  await play('deadline-answer.mp3');
  const notes = page.getByRole('region', { name: 'Meeting notes', exact: true });
  await expect(notes).toContainText(/15 November|November 15|lima belas November/i, { timeout: 50000 });
  await expect(notes).toContainText('Rina', { timeout: 35000 });
  expect(questionResponses).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Meeting transcript', exact: true })).toHaveValue(/November[\s\S]*Rina/i, { timeout: 45000 });
  expect(errors).toEqual([]);
});
