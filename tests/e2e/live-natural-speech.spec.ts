import { test, expect } from '@playwright/test';
import { mockDirectStream } from './helpers/direct-stream';

test.describe('Mandatory Real Meeting Flow', () => {
  test('natural bilingual speech stream, live updates, AI clarification, meeting notes, clean stop, and reload restore', async ({ page, context }) => {
    test.setTimeout(90000);
    await mockDirectStream(page);
    await context.grantPermissions(['microphone']);
    // The text provider is deterministic; give the real capture pipeline a silent
    // microphone too so the required 2200ms natural pause can actually occur.
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        const audio = new AudioContext(); await audio.resume();
        const destination = audio.createMediaStreamDestination();
        const oscillator = audio.createOscillator(); const gain = audio.createGain();
        gain.gain.value = 0;
        oscillator.connect(gain); gain.connect(destination); oscillator.start();
        return destination.stream;
      };
    });

    // Mock AI endpoints for predictable end-to-end verification
    let aiAnalysisCount = 0;
    await page.route('**/api/session', route => route.fulfill({ json: { ai: true } }));
    await page.route('**/api/interruption', async route => {
      aiAnalysisCount++;
      const body = route.request().postDataJSON();
      const text = body.transcript || '';
      const final = !!body.final;

      if (final) {
        return route.fulfill({
          json: {
            shouldInterrupt: false,
            confidence: 0,
            category: 'none',
            question: '',
            reason: '',
            gapKey: '',
            notes: 'Launch scheduled for Friday with new features. Jovan owns deployment.',
            context: {
              summary: 'The team will launch the new website and features this Friday. Jovan is responsible for the deployment.',
              topics: ['Website Launch', 'Feature Deployment'],
              decisions: ['Deploy website on Friday', 'Jovan is the deployment owner'],
              actionItems: ['Deploy landing page', 'Verify new features before launch'],
              structuredActionItems: [
                { task: 'Deploy website and features', owner: 'Jovan', deadline: 'Friday', approved: false },
              ],
              deadlines: ['Friday'],
              people: ['Jovan'],
              unresolvedQuestions: [],
            },
          },
        });
      }

      // If user said "We will launch next week" without owner, offer clarification
      if (text.includes('launch') && !text.includes('Jovan')) {
        return route.fulfill({
          json: {
            shouldInterrupt: true,
            confidence: 0.92,
            category: 'owner',
            question: 'Siapa yang akan deploy website ini hari Jumat?',
            reason: 'Owner belum ditentukan untuk peluncuran hari Jumat.',
            gapKey: 'owner:deployment',
            notes: 'Peluncuran hari Jumat, PIC deployment belum jelas.',
            context: {
              summary: 'Diskusi rencana peluncuran website dan fitur baru.',
              topics: ['Peluncuran Website'],
              decisions: ['Target rilis hari Jumat'],
              actionItems: ['Tentukan PIC deployment'],
              unresolvedQuestions: ['Siapa yang deploy?'],
            },
          },
        });
      }

      // When owner Jovan is known, resolve gap
      return route.fulfill({
        json: {
          shouldInterrupt: false,
          confidence: 0.95,
          category: 'none',
          question: '',
          reason: '',
          gapKey: '',
          notes: 'Peluncuran hari Jumat di-handle oleh Jovan.',
          context: {
            summary: 'Website launch this Friday, Jovan deploys.',
            topics: ['Deployment'],
            decisions: ['Jovan deploys Friday'],
            actionItems: ['Deploy landing page'],
            unresolvedQuestions: [],
          },
        },
      });
    });

    await page.route('**/api/transcribe', route =>
      route.fulfill({
        json: {
          transcript:
            'We will launch the website next Friday.\n\nKita akan deploy website ini hari Jumat.\n\nKita akan launch feature baru minggu depan.',
        },
      })
    );

    // 1. Open application
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Start recording', exact: true })).toBeVisible();
    // This test verifies an on-screen clarification, not external voice playback.
    await page.getByRole('button', { name: 'AI Voice: ON', exact: true }).click();

    // 2. Start Meeting & Grant microphone
    await page.getByRole('button', { name: 'Start recording', exact: true }).click();
    await page.waitForFunction(() => (window as unknown as { testDirect: { connected: boolean } }).testDirect?.connected);

    const transcriptRegion = page.getByRole('region', { name: 'Live transcript', exact: true });

    // 3. Speak English: "We will launch the website next Friday."
    // Verify transcript appears progressively BEFORE Stop
    const englishUtterance = 'We will launch the website next Friday.';
    await page.evaluate(() => (window as unknown as { testDirect: { emit: (t: string, s: string) => void } }).testDirect.emit('partial', 'We will'));
    await expect(transcriptRegion).toContainText('We will');
    await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible();

    await page.evaluate(() => (window as unknown as { testDirect: { emit: (t: string, s: string) => void } }).testDirect.emit('partial', 'We will launch the website'));
    await expect(transcriptRegion).toContainText('We will launch the website');

    await page.evaluate(text => (window as unknown as { testDirect: { emit: (t: string, s: string) => void } }).testDirect.emit('partial', text), englishUtterance);
    await expect(transcriptRegion).toContainText(englishUtterance);

    // Pause & finalize English utterance
    await page.evaluate(text => (window as unknown as { testDirect: { emit: (t: string, s: string) => void } }).testDirect.emit('final', text), englishUtterance);
    await expect(transcriptRegion).toContainText(englishUtterance);

    // 4. Speak Indonesian: "Kita akan deploy website ini hari Jumat."
    // Verify speech resumes correctly and updates
    const idUtterance = 'Kita akan deploy website ini hari Jumat.';
    await page.evaluate(text => (window as unknown as { testDirect: { emit: (t: string, s: string) => void } }).testDirect.emit('partial', text), 'Kita akan deploy');
    await expect(transcriptRegion).toContainText('Kita akan deploy');

    await page.evaluate(text => (window as unknown as { testDirect: { emit: (t: string, s: string) => void } }).testDirect.emit('partial', text), idUtterance);
    await expect(transcriptRegion).toContainText(idUtterance);

    await page.evaluate(text => (window as unknown as { testDirect: { emit: (t: string, s: string) => void } }).testDirect.emit('final', text), idUtterance);
    await expect(transcriptRegion).toContainText(idUtterance);

    // 5. Speak Mixed: "Kita akan launch feature baru minggu depan."
    const mixedUtterance = 'Kita akan launch feature baru minggu depan.';
    await page.evaluate(text => (window as unknown as { testDirect: { emit: (t: string, s: string) => void } }).testDirect.emit('partial', text), 'Kita akan launch');
    await expect(transcriptRegion).toContainText('Kita akan launch');

    await page.evaluate(text => (window as unknown as { testDirect: { emit: (t: string, s: string) => void } }).testDirect.emit('final', text), mixedUtterance);
    await expect(transcriptRegion).toContainText(mixedUtterance);

    // 6. Verify AI reads transcript asynchronously and surfaces clarification without blocking recording
    await expect(page.getByRole('region', { name: 'AI clarification', exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('region', { name: 'AI clarification', exact: true })).toContainText('Siapa yang akan deploy');

    // Verify AI analysis occurred asynchronously
    expect(aiAnalysisCount).toBeGreaterThanOrEqual(1);

    // 7. Stop meeting cleanly
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click();

    // 8. Meeting transcript remains accessible in editor
    const editor = page.getByRole('textbox', { name: 'Meeting transcript', exact: true });
    await expect(editor).toBeVisible({ timeout: 20000 });
    await expect(editor).toHaveValue(/We will launch[\s\S]*Kita akan deploy[\s\S]*Kita akan launch/i);

    // 9. Meeting notes / intelligence are generated
    const contextRegion = page.getByRole('complementary', { name: 'Meeting context', exact: true });
    await expect(contextRegion).toContainText(/Launch scheduled for Friday|Jovan/i, { timeout: 20000 });
    await expect(contextRegion).toContainText('Deploy website and features');

    // 10. Refresh page — recent meeting must be restored with "Meeting restored" notice
    await page.reload();
    await expect(page.getByText('Meeting restored', { exact: false })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('textbox', { name: 'Meeting transcript', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Meeting transcript', exact: true })).toHaveValue(/We will launch/i);
  });
});
