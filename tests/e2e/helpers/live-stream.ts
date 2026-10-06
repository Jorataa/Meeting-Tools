import type { Page } from '@playwright/test';

/** Real browser AudioWorklet + MediaRecorder, deterministic streamed provider.
 * Unlike route.fulfill this sends events separately while the mic is running. */
export async function mockLiveStream(page: Page) {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    let output: ReadableStreamDefaultController<Uint8Array> | undefined;
    let sequence = 0;
    const encoder = new TextEncoder();
    const state = {
      frames: 0, bytes: 0, nonzero: false, connected: false,
      emit(type: string, text = '', id = 'test-final-1') {
        output?.enqueue(encoder.encode(`id: ${++sequence}\ndata: ${JSON.stringify({ sequence, type, text, id, at: .2, status: 'listening' })}\n\n`));
      },
    };
    (window as unknown as { testLive: typeof state }).testLive = state;
    window.fetch = async (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin);
      if (url.pathname !== '/api/live/stream') return original(input, options);
      const method = options?.method || 'GET';
      if (method === 'GET') {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) { output = controller; state.connected = true; state.emit('ready'); },
          cancel() { output = undefined; state.connected = false; },
        }), { headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (!url.searchParams.has('id')) return Response.json({ id: 'test-stream' });
      if (url.searchParams.has('frame')) {
        const bytes = new Uint8Array(await new Response(options?.body).arrayBuffer());
        state.frames++; state.bytes += bytes.length; state.nonzero ||= bytes.some(byte => byte !== 0);
      }
      if (url.searchParams.get('action') === 'end' || url.searchParams.get('action') === 'cancel') {
        state.emit('done'); output?.close(); output = undefined; state.connected = false;
      }
      return Response.json({ ok: true });
    };
  });
}

export async function emitTranscript(page: Page, type: 'partial' | 'final', text: string, id = 'test-final-1') {
  await page.waitForFunction(() => (window as unknown as { testLive?: { connected: boolean } }).testLive?.connected);
  await page.evaluate(({ type, text, id }) => {
    (window as unknown as { testLive: { emit: (type: string, text: string, id: string) => void } }).testLive.emit(type, text, id);
  }, { type, text, id });
}
