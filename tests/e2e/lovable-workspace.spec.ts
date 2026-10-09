import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { emitTranscript, mockLiveStream } from './helpers/live-stream';

const summary = 'The team will launch on Friday. Sarah owns the release.';
const meeting = {
  id: 'ac1c1d3b-a313-46fc-bac6-44bf73c6b4ef', title: 'Friday launch',
  transcript: '[00:12] Participant: We will launch Friday.\n\n[00:25] Alex: I can review.\n\n[00:38] Participant: I will publish.',
  notes: 'Release planning notes.', date: 1791543600000, elapsed: 120,
  context: { summary, topics: ['Launch'], decisions: ['Launch Friday'], actionItems: ['Publish release'],
    structuredActionItems: [{ task: 'Publish release', owner: 'Sarah', deadline: 'Friday' }],
    unresolvedQuestions: ['Who signs off?'], resolvedQuestions: [] },
};
async function demo(page: Page) {
  await page.route('**/api/auth', route => route.fulfill({ json: { mode: 'demo', user: null } }));
  await page.route('**/api/session', route => route.fulfill({ json: { ai: true } }));
}
async function openSaved(page: Page) {
  await demo(page);
  await page.addInitScript(document => { if (!JSON.parse(localStorage.getItem('hush.meetings.v1') || '[]').length) localStorage.setItem('hush.meetings.v1', JSON.stringify([document])); }, meeting);
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /^Meetings/ }).click();
  await page.getByRole('region', { name: 'Saved meetings', exact: true }).getByRole('button', { name: /Friday launch/ }).click();
}

test('presets fill meeting context and dropped audio opens a validated preview', async ({ page }) => {
  await demo(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Team Standup', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Meeting title' })).toHaveValue('Team Standup');
  await expect(page.getByRole('region', { name: 'Detected topics' })).toContainText('Blockers');
  const bytes = Array.from(await readFile(path.resolve('tests/fixtures/english.wav')));
  const transfer = await page.evaluateHandle(bytes => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(bytes)], 'conversation.wav', { type: 'audio/wav' }));
    return data;
  }, bytes);
  await page.dispatchEvent('body', 'dragenter', { dataTransfer: transfer });
  await expect(page.locator('.audio-dropzone')).toBeVisible();
  await expect(page.locator('.drop-file')).toContainText('conversation.wav');
  await page.dispatchEvent('body', 'drop', { dataTransfer: transfer });
  await expect(page.locator('.audio-dropzone')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Transcribe audio', exact: true })).toBeVisible();
  await expect(page.getByLabel('Preview selected audio')).toBeVisible();
  await expect(page.getByText('conversation.wav', { exact: true })).toBeVisible();
  await transfer.dispose();
});

test('executive checklist, resolved inquiries, and speaker names survive reload', async ({ page }) => {
  await openSaved(page);
  const brief = page.getByRole('region', { name: 'Executive brief' });
  await expect(brief).toContainText('The team will launch on Friday.');
  await expect(brief).not.toContainText('Sarah owns the release.');
  await brief.getByRole('checkbox', { name: /Publish release/ }).check();
  await brief.getByRole('button', { name: 'Mark as resolved', exact: true }).click();
  await page.getByRole('button', { name: 'Rename speaker Participant', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Rename Participant', exact: true }).fill('Sarah');
  await page.getByRole('button', { name: 'Save speaker name', exact: true }).click();
  const transcript = page.getByRole('textbox', { name: 'Meeting transcript', exact: true });
  await expect(transcript).toHaveValue('[00:12] Sarah: We will launch Friday.\n\n[00:25] Alex: I can review.\n\n[00:38] Sarah: I will publish.');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('hush.meetings.v1') || '[]')[0]?.notes)).toContain('- [x] Publish release');
  await page.reload();
  await expect(brief.getByRole('checkbox', { name: /Publish release/ })).toBeChecked();
  await expect(transcript).toHaveValue(/Sarah:[\s\S]*Alex:[\s\S]*Sarah:/);
  await expect(brief.getByRole('button', { name: 'Mark as resolved' })).toHaveCount(0);
  await expect(page.getByText('Resolved questions · 1')).toBeVisible();
});

test('Slack, Notion, Markdown, raw text, and summary shortcut share structured content', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openSaved(page);
  const share = page.getByRole('button', { name: 'Share & export' });
  await share.click();
  await page.getByRole('menuitem', { name: 'Copy for Slack' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('*Summary*\nThe team will launch on Friday.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(':white_large_square: Publish release — Sarah · Due Friday');
  await share.click();
  await page.getByRole('menuitem', { name: 'Copy for Notion' }).click();
  const notion = await page.evaluate(() => navigator.clipboard.readText());
  expect(notion).toContain('> 💡 The team will launch on Friday.');
  expect(notion).toContain('- [ ] Publish release — Sarah · Due Friday');
  await share.click();
  const exportEvent = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export Markdown (.md)' }).click();
  const exported = await exportEvent;
  expect(exported.suggestedFilename()).toBe('Friday launch.md');
  const markdown = await readFile((await exported.path())!, 'utf8');
  expect(markdown).toContain('[00:12] **Participant:** We will launch Friday.');
  expect(markdown).toContain('## Unresolved inquiries');
  await page.keyboard.press('Control+Shift+C');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('*Key decisions*');
  await share.click();
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: 'Raw text (.txt)' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(share).toBeFocused();
  await expect(page.getByRole('menu')).not.toBeVisible();
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }));
  await page.keyboard.press('Control+Shift+C');
  await expect(page.getByText('Clipboard unavailable. Use Share & export to download Markdown.', { exact: true })).toBeVisible();
});

test('recording shortcuts respect input focus and panels remain usable at small sizes', async ({ page, context }) => {
  await demo(page); await mockLiveStream(page);
  await page.route('**/api/interruption', route => route.fulfill({ json: { shouldInterrupt: false, confidence: 0, category: 'none', question: '', reason: '', gapKey: '', notes: '' } }));
  await context.grantPermissions(['microphone']);
  await page.goto('/');
  const title = page.getByRole('textbox', { name: 'Meeting title' });
  await title.fill('Planning'); await title.press('Space');
  await expect(page.getByRole('button', { name: 'Stop recording' })).not.toBeVisible();
  await title.evaluate(node => (node as HTMLInputElement).blur());
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('button', { name: 'Resume recording', exact: true })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Pause recording', exact: true })).toBeVisible();
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('tab', { name: 'Context & notes', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Meeting context', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const dock = await page.locator('.meeting-control-dock').boundingBox();
    expect(dock!.y + dock!.height).toBeLessThanOrEqual(844);
    await page.getByRole('tab', { name: 'Transcript', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Cancel recording', exact: true }).click();
});

test('muted voice can ask aloud with PCM suppression, then pin or dismiss a whisper', async ({ page }) => {
  test.setTimeout(45000);
  await demo(page); await mockLiveStream(page);
  await page.addInitScript(() => {
    class Recognition {
      continuous = false; interimResults = false; maxAlternatives = 1; lang = '';
      onresult: ((event: unknown) => void) | null = null;
      onerror = null; onend: (() => void) | null = null;
      stopped = false;
      constructor() { (window as unknown as { whisperRecognition: Recognition }).whisperRecognition = this; }
      start() { this.stopped = false; }
      stop() { this.stopped = true; this.onend?.(); }
      abort() { this.stop(); }
    }
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: Recognition });
    Object.defineProperty(window, 'SpeechRecognition', { value: Recognition });
    navigator.mediaDevices.getUserMedia = async () => {
      const audio = new AudioContext(); await audio.resume();
      const destination = audio.createMediaStreamDestination();
      const oscillator = audio.createOscillator(); const gain = audio.createGain(); gain.gain.value = 0;
      oscillator.connect(gain); gain.connect(destination); oscillator.start();
      return destination.stream;
    };
    Object.defineProperty(window, 'speechSynthesis', { value: {
      getVoices: () => [], cancel: () => {},
      speak: (utterance: SpeechSynthesisUtterance) => {
        (window as unknown as { finishWhisper: () => void }).finishWhisper = () => utterance.onend?.(new Event('end') as SpeechSynthesisEvent);
        utterance.onstart?.(new Event('start') as SpeechSynthesisEvent);
      },
    } });
  });
  const question = 'Who owns the Friday launch?';
  await page.route('**/api/interruption', route => route.fulfill({ json: { shouldInterrupt: true, confidence: 0.94, relevance: 0.95, category: 'owner', question, reason: 'An owner will make the next step clearer.', gapKey: 'owner:launch', notes: 'Launch Friday.', context: meeting.context } }));
  await page.route('**/api/voice', route => route.fulfill({ status: 502, json: { error: 'Unavailable' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'AI Voice: ON', exact: true }).click();
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await emitTranscript(page, 'final', 'We will launch Friday.');
  const whisper = page.getByRole('region', { name: 'AI clarification', exact: true });
  await expect(whisper).toBeVisible({ timeout: 20000 });
  await whisper.getByRole('button', { name: 'Ask aloud', exact: true }).click();
  await expect(page.locator('.meeting-badge')).toHaveText('AI speaking');
  await expect.poll(() => page.evaluate(() => (window as unknown as { whisperRecognition: { stopped: boolean } }).whisperRecognition.stopped)).toBe(true);
  await page.evaluate(() => (window as unknown as { whisperRecognition: { onresult: (event: unknown) => void } }).whisperRecognition.onresult({ resultIndex: 0, results: [{ isFinal: true, length: 1, 0: { transcript: 'AI voice echo must not be captured.', confidence: 1 } }] }));
  await expect(page.getByRole('region', { name: 'Live transcript', exact: true })).not.toContainText('AI voice echo');
  await page.waitForTimeout(350); // Allow frames already in flight to drain.
  const frames = await page.evaluate(() => (window as unknown as { testLive: { frames: number } }).testLive.frames);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => (window as unknown as { testLive: { frames: number } }).testLive.frames)).toBe(frames);
  await page.evaluate(() => (window as unknown as { finishWhisper: () => void }).finishWhisper());
  await expect(page.locator('.meeting-badge')).toHaveText('LIVE');
  await expect.poll(() => page.evaluate(() => (window as unknown as { testLive: { frames: number } }).testLive.frames)).toBeGreaterThan(frames);
  await whisper.getByRole('button', { name: /Acknowledge/ }).click();
  await expect(whisper).not.toBeVisible();
  await expect(page.getByRole('region', { name: 'Meeting notes', exact: true })).toContainText(`## Agenda\n- ${question}`);
  await page.getByRole('button', { name: 'Cancel recording', exact: true }).click();
});

test('welcome and completed views render cleanly across desktop, tablet, and mobile', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await demo(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Start recording', exact: true }).waitFor();
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/hush-welcome-${width}.png` });
  }
  await openSaved(page);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('region', { name: 'Executive brief' })).toBeVisible();
    await page.screenshot({ path: `/tmp/hush-completed-${width}.png` });
  }
  expect(errors).toEqual([]);
});
