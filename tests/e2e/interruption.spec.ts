import { test, expect, type Page } from '@playwright/test';
import { wav } from '../../lib/audio/wav';
import { emitTranscript, mockLiveStream } from './helpers/live-stream';
const question = 'Tanggal berapa deadline peluncuran?';
const unclear = 'Kita harus launch bulan depan.';
const answer = 'Deadline tanggal 15 November. Rina yang bertanggung jawab.';
const gap = { shouldInterrupt: true, confidence: .94, category: 'deadline', question, reason: 'Tanggal belum jelas.', gapKey: 'deadline:launch', notes: 'Peluncuran bulan depan, tanggal belum jelas.' };
const resolved = { ...gap, shouldInterrupt: false, category: 'none', question: '', gapKey: '', notes: 'Deadline: 15 November. Penanggung jawab: Rina.' };

async function controlledMicrophone(page: Page) {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext(); await context.resume();
      const source = context.createOscillator(); source.frequency.value = 220;
      const gain = context.createGain(); gain.gain.value = 0;
      const destination = context.createMediaStreamDestination();
      source.connect(gain); gain.connect(destination); source.start();
      (window as unknown as { participantGain: GainNode }).participantGain = gain;
      return destination.stream;
    };
  });
}
const participant = (page: Page, active: boolean) => page.evaluate(active => {
  (window as unknown as { participantGain: GainNode }).participantGain.gain.value = active ? .15 : 0;
}, active);
test.beforeEach(async ({ page }) => {
  await mockLiveStream(page);
  await page.route('**/api/session', route => route.fulfill({ json: { ai: true } }));
});

test('live audio → natural pause → Gemini voice → answer → updated notes → final transcript', async ({ page }) => {
  test.setTimeout(60000);
  await controlledMicrophone(page);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let spoken = 0, answered = false;
  await page.route('**/api/interruption', async route => {
    const input = route.request().postDataJSON();
    answered = input.transcript.includes('15 November');
    if (answered) expect(input.asked[0].question).toBe(question);
    await route.fulfill({ json: answered || input.final ? resolved : gap });
  });
  await page.route('**/api/voice', async route => {
    spoken++; expect(route.request().postDataJSON().text).toBe(question);
    const samples = new Int16Array(6000); for (let i = 0; i < samples.length; i++) samples[i] = Math.round(Math.sin(i * .1) * 4000);
    await route.fulfill({ contentType: 'audio/wav', body: Buffer.from(wav(samples, 24000)) });
  });
  await page.route('**/api/transcribe', route => route.fulfill({ json: { transcript: `${unclear}\n\nHush: ${question}\n\n${answer}` } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible();
  await participant(page, true); await emitTranscript(page, 'partial', unclear); await page.waitForTimeout(500); await participant(page, false); await page.waitForTimeout(350);
  await emitTranscript(page, 'final', unclear);
  await expect(page.getByRole('region', { name: 'Live transcript', exact: true })).toContainText(unclear);
  expect(spoken).toBe(0);
  await expect(page.getByRole('region', { name: 'Live transcript', exact: true })).toContainText(question, { timeout: 18000 });
  await expect(page.getByText('AI is asking a question…')).not.toBeVisible();
  await participant(page, true); await emitTranscript(page, 'partial', answer, 'answer'); await page.waitForTimeout(500); await participant(page, false); await page.waitForTimeout(350);
  await emitTranscript(page, 'final', answer, 'answer');
  await expect(page.getByRole('region', { name: 'Meeting notes', exact: true })).toContainText('15 November', { timeout: 18000 });
  expect(answered).toBe(true); expect(spoken).toBe(1);
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Meeting transcript', exact: true })).toHaveValue(`${unclear}\n\nHush: ${question}\n\n${answer}`);
  expect(errors).toEqual([]);
});

test('voice OFF keeps real recording and live transcript working on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await controlledMicrophone(page);
  let voiceCalls = 0;
  await page.route('**/api/interruption', route => route.fulfill({ json: gap }));
  await page.route('**/api/voice', route => { voiceCalls++; return route.fulfill({ status: 502, json: { error: 'Unavailable' } }); });
  await page.goto('/'); await page.getByRole('tab', { name: 'Context & notes', exact: true }).click(); await page.getByRole('button', { name: 'AI Voice: ON', exact: true }).click();
  await expect(page.getByRole('button', { name: 'AI Voice: OFF', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('tab', { name: 'Transcript', exact: true }).click();
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await participant(page, true); await emitTranscript(page, 'partial', unclear); await page.waitForTimeout(500); await participant(page, false); await page.waitForTimeout(350);
  await emitTranscript(page, 'final', unclear);
  await expect(page.getByRole('region', { name: 'Live transcript', exact: true })).toContainText(unclear);
  await expect(page.getByRole('region', { name: 'AI clarification', exact: true })).toBeVisible();
  expect(voiceCalls).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('tab', { name: 'Context & notes', exact: true }).click();
  await page.getByRole('button', { name: 'AI Interruption: ON', exact: true }).click();
  await page.getByRole('tab', { name: 'Transcript', exact: true }).click();
  await expect(page.getByRole('region', { name: 'AI clarification', exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Cancel recording', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Live transcript', exact: true })).not.toBeVisible();
});

test('live service failure leaves Stop recording available and full transcription succeeds', async ({ page }) => {
  await controlledMicrophone(page);
  await page.addInitScript(() => {
    const previous = window.fetch.bind(window);
    window.fetch = async (input, options) => String(input).split('?')[0] === '/api/live/stream' && options?.method === 'POST'
      ? Response.json({ error: 'Live transcription is temporarily unavailable.' }, { status: 503 }) : previous(input, options);
  });
  await page.route('**/api/interruption', route => route.fulfill({ json: resolved }));
  await page.route('**/api/transcribe', route => route.fulfill({ json: { transcript: answer } }));
  await page.goto('/'); await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible();
  await participant(page, true); await page.waitForTimeout(2200); await participant(page, false);
  await expect(page.getByText('Live transcription is temporarily unavailable.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Meeting transcript', exact: true })).toHaveValue(answer);
});
