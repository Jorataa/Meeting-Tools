import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { mockLiveStream } from './helpers/live-stream';
const fixture = (name: string) => path.resolve('tests/fixtures', name);
const sample = 'Selamat pagi. The API deadline is Friday.\n\nAnggaran proyek lima juta rupiah.';
test.beforeEach(async ({ page }, info) => {
  if (!info.title.startsWith('live ')) await mockLiveStream(page);
  await page.route('**/api/live/transcribe', route => route.fulfill({ json: { transcript: '' } }));
  await page.route('**/api/interruption', route => route.fulfill({ json: { shouldInterrupt: false, confidence: 0, category: 'none', question: '', reason: '', gapKey: '', notes: '' } }));
  if (!info.title.startsWith('live ')) await page.route('**/api/session', route => route.fulfill({ json: { ai: true } }));
});
async function mockTranscription(page: Page, transcript = sample) {
  await page.route('**/api/transcribe', route => route.fulfill({ json: { transcript } }));
}
async function upload(page: Page, name = 'indonesian.mp3') {
  await page.getByLabel('Choose audio file').setInputFiles(fixture(name));
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Transcribe audio', exact: true }).click();
}

test('idle loads without requesting the microphone', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'micCalls', { value: 0, writable: true });
    navigator.mediaDevices.getUserMedia = async () => { (window as unknown as {micCalls:number}).micCalls++; throw new DOMException('denied', 'NotAllowedError'); };
  });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start recording', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as {micCalls:number}).micCalls)).toBe(0);
  expect(errors).toEqual([]);
});

test('records through real MediaRecorder and uploads the complete audio', async ({ page, context }) => {
  await context.grantPermissions(['microphone']);
  let actualAudio = false;
  await page.route('**/api/transcribe', async route => {
    const body = route.request().postDataBuffer()!;
    actualAudio = body.includes(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) && body.length > 1000;
    expect(route.request().headers()['content-type']).toContain('multipart/form-data');
    expect(body.toString()).not.toContain('GEMINI_API_KEY');
    await route.fulfill({ json: { transcript: sample } });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible();
  await expect(page.locator('.recording-time')).toHaveText('00:02', { timeout: 6000 });
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Meeting transcript', exact: true })).toHaveValue(sample);
  expect(actualAudio).toBe(true);
});

test('microphone permission denial leaves upload available', async ({ page }) => {
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('permission denied', 'NotAllowedError'); }; });
  await page.goto('/'); await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('Microphone access is blocked');
  await expect(page.getByRole('button', { name: 'Upload audio', exact: true })).toBeEnabled();
  await mockTranscription(page); await upload(page); await expect(page.getByRole('textbox', { name: 'Meeting transcript', exact: true })).toHaveValue(sample);
});

test('permission is requested only on click, and cancelling releases a late stream', async ({ page, context }) => {
  await context.grantPermissions(['microphone']);
  await page.addInitScript(() => {
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const testWindow = window as unknown as { grantMic: () => Promise<void>; grantedStream: MediaStream };
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { testWindow.grantMic = async () => { testWindow.grantedStream = await real({ audio: true }); resolve(testWindow.grantedStream); }; });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByText('Allow your microphone', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => (window as unknown as { grantMic: () => Promise<void> }).grantMic());
  await expect.poll(() => page.evaluate(() => (window as unknown as { grantedStream: MediaStream }).grantedStream.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
  await expect(page.getByRole('button', { name: 'Start recording', exact: true })).toBeVisible();
});

test('no microphone and unsupported recorder have helpful fallbacks', async ({ page }) => {
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('no device', 'NotFoundError'); }; });
  await page.goto('/'); await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('No microphone was found');
  await page.evaluate(() => { Object.defineProperty(window, 'MediaRecorder', { value: undefined }); });
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('not supported');
  await expect(page.getByRole('button', { name: 'Upload audio', exact: true })).toBeEnabled();
});

test('cancel recording stops tracks without submitting audio', async ({ page, context }) => {
  await context.grantPermissions(['microphone']);
  await page.addInitScript(() => {
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async () => { const stream = await real({ audio: true }); (window as unknown as {stream:MediaStream}).stream = stream; return stream; };
  });
  let calls = 0; await page.route('**/api/transcribe', route => { calls++; return route.fulfill({ json: { transcript: sample } }); });
  await page.goto('/'); await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel recording', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel recording', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as {stream:MediaStream}).stream.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
  expect(calls).toBe(0); await expect(page.getByRole('button', { name: 'Start recording', exact: true })).toBeVisible();
});

test('upload MP3, edit, copy entire transcript, download, reset', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await mockTranscription(page); await page.goto('/'); await upload(page);
  const text = `${sample}\n\nEdited: owner is Rina, budget Rp5.000.000.`;
  await page.getByRole('textbox', { name: 'Meeting transcript', exact: true }).fill(text);
  await page.getByRole('button', { name: 'Copy transcript', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .txt', exact: true }).click();
  const download = await event; expect(download.suggestedFilename()).toBe('meeting-transcript.txt');
  expect(await readFile((await download.path())!, 'utf8')).toBe(text);
  await page.getByRole('button', { name: 'New transcription', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start recording', exact: true })).toBeVisible();
});

test('invalid, empty and oversized files produce readable errors', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Choose audio file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not audio') });
  await expect(page.locator('main').getByRole('alert')).toContainText("format isn't supported");
  await page.getByLabel('Choose audio file').setInputFiles({ name: 'empty.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(0) });
  await expect(page.locator('main').getByRole('alert')).toContainText('empty');
  await page.getByLabel('Choose audio file').setInputFiles({ name: 'large.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(12 * 1024 * 1024 + 1) });
  await expect(page.locator('main').getByRole('alert')).toContainText('too large');
});

test('Gemini failure retains audio for retry and save', async ({ page }) => {
  await page.route('**/api/transcribe', route => route.fulfill({ status: 502, json: { code: 'SERVICE_UNAVAILABLE', error: "We couldn't reach the transcription service. Please try again." } }));
  await page.goto('/'); await upload(page);
  await expect(page.locator('main').getByRole('alert')).toContainText("couldn't reach");
  await expect(page.getByRole('button', { name: 'Save audio' })).toBeVisible();
  await page.unroute('**/api/transcribe'); await mockTranscription(page);
  await page.getByRole('button', { name: 'Try transcription again' }).click();
  await expect(page.getByRole('textbox', { name: 'Meeting transcript', exact: true })).toHaveValue(sample);
});

test('malformed JSON responses preserve audio and allow successful retry', async ({ page }) => {
  const pageErrors: string[] = []; page.on('pageerror', error => pageErrors.push(error.message));
  const invalidResponses = [
    { name: 'null success response', status: 200, body: null },
    { name: 'null error response', status: 502, body: null },
    { name: 'array response', status: 200, body: [] },
    { name: 'primitive response', status: 200, body: 'invalid' },
    { name: 'missing transcript', status: 200, body: {} },
    { name: 'null transcript', status: 200, body: { transcript: null } },
    { name: 'numeric transcript', status: 200, body: { transcript: 42 } },
    { name: 'blank transcript', status: 200, body: { transcript: ' \n ' } },
    { name: 'invalid error code', status: 502, body: { code: {}, error: 'Private upstream details' } },
  ];
  let requests = 0;
  await page.route('**/api/transcribe', route => {
    const response = invalidResponses[requests++];
    return response
      ? route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) })
      : route.fulfill({ json: { transcript: sample } });
  });
  await page.goto('/'); await upload(page);
  for (const response of invalidResponses) {
    await test.step(response.name, async () => {
      await expect(page.locator('main').getByRole('alert')).toHaveText("We couldn't transcribe this recording. Please try again.");
      await expect(page.getByRole('button', { name: 'Save audio' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Cancel transcription' })).toHaveCount(0);
      await page.getByRole('button', { name: 'Try transcription again' }).click();
    });
  }
  await expect(page.getByRole('textbox', { name: 'Meeting transcript', exact: true })).toHaveValue(sample);
  expect(requests).toBe(invalidResponses.length + 1);
  expect(pageErrors).toEqual([]);
});

test('processing is visible and cancellation ignores late results', async ({ page }) => {
  let finish: () => void = () => {};
  await page.route('**/api/transcribe', async route => {
    await new Promise<void>(resolve => { finish = resolve; });
    await route.fulfill({ json: { transcript: sample } }).catch(() => {});
  });
  await page.goto('/'); await upload(page);
  await expect(page.getByRole('heading', { name: /Sending your audio|Transcribing/  })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel transcription' }).click(); finish();
  await expect(page.getByRole('button', { name: 'Transcribe audio', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Meeting transcript', exact: true })).toHaveCount(0);
});

test('network and non-JSON hosting errors are understandable', async ({ page }) => {
  await page.route('**/api/transcribe', route => route.abort('failed'));
  await page.goto('/'); await upload(page); await expect(page.locator('main').getByRole('alert')).toContainText('Connection lost');
  await page.unroute('**/api/transcribe'); await page.route('**/api/transcribe', route => route.fulfill({ status: 413, body: '<html>internal hosting error</html>' }));
  await page.getByRole('button', { name: 'Try transcription again' }).click(); await expect(page.locator('main').getByRole('alert')).toContainText('server limit');
});

test('mobile controls and transcript fit without horizontal scrolling', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await mockTranscription(page); await page.goto('/');
  const record = await page.getByRole('button', { name: 'Start recording', exact: true }).boundingBox(); expect(record!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.grantPermissions(['microphone']); await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Cancel recording' }).click();
  await upload(page); await expect(page.getByRole('textbox', { name: 'Meeting transcript', exact: true })).toHaveValue(sample);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/hush-mobile-result.png', fullPage: true });
});

test.describe('live Gemini', () => {
  test.skip(!process.env.RUN_LIVE_GEMINI, 'Set RUN_LIVE_GEMINI=1 to send test audio through the real backend to Gemini.');
  test.setTimeout(150000);
  test('live streaming microphone emits interim text while recording remains active', async ({ page, context }) => {
    await context.grantPermissions(['microphone']);
    await page.addInitScript(() => {
      (window as unknown as { observedPartialCount: number }).observedPartialCount = 0;
      const original = window.fetch.bind(window);
      window.fetch = async (input, options) => {
        const response = await original(input, options);
        if (String(input).startsWith('/api/live/stream?') && (options?.method || 'GET') === 'GET' && response.body) {
          const observed = response.clone().body!.getReader();
          void (async () => {
            const decoder = new TextDecoder(); let buffer = '';
            while (true) {
              const { value, done } = await observed.read(); if (done) break;
              buffer += decoder.decode(value, { stream: true });
              let boundary: number;
              while ((boundary = buffer.indexOf('\n\n')) >= 0) {
                const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
                const data = block.split('\n').find(line => line.startsWith('data: '));
                if (data && JSON.parse(data.slice(6)).type === 'partial') (window as unknown as { observedPartialCount: number }).observedPartialCount++;
              }
            }
          })().catch(() => {});
        }
        return response;
      };
    });
    await page.goto('/'); await page.getByRole('button', { name: 'Start recording', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { observedPartialCount: number }).observedPartialCount), { timeout: 45000 }).toBeGreaterThan(0);
    await expect(page.getByRole('region', { name: 'Live transcript', exact: true })).toContainText(/bridge|brooklyn/i, { timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible();
    await page.screenshot({ path: '/tmp/hush-real-live-transcript.png', fullPage: true });
    await page.getByRole('button', { name: 'Cancel recording', exact: true }).click();
  });
  for (const [name, words] of [['english.wav', ['brooklyn', 'bridge']], ['indonesian.mp3', ['selamat', 'rapat', 'juta']], ['mixed.mp3', ['besok', 'deadline', 'friday']]] as const) {
    test(`live upload ${name} preserves speech`, async ({ page }) => {
      await page.goto('/'); await upload(page, name);
      await expect(page.getByRole('textbox', { name: 'Meeting transcript', exact: true })).toBeVisible({ timeout: 135000 });
      const text = (await page.getByRole('textbox', { name: 'Meeting transcript', exact: true }).inputValue()).toLowerCase();
      for (const word of words) expect(text).toContain(word);
      expect(text).not.toMatch(/^(summary|ringkasan):/);
    });
  }
  test('live microphone recording reaches Gemini and returns a transcript', async ({ page, context }) => {
    await context.grantPermissions(['microphone']); await page.goto('/');
    await page.getByRole('button', { name: 'Start recording', exact: true }).click();
    await expect(page.locator('.recording-time')).toHaveText('00:09', { timeout: 12000 });
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Meeting transcript', exact: true })).toBeVisible({ timeout: 135000 });
    expect((await page.getByRole('textbox', { name: 'Meeting transcript', exact: true }).inputValue()).toLowerCase()).toContain('bridge');
    await page.screenshot({ path: '/tmp/hush-desktop-result.png', fullPage: true });
  });
});
