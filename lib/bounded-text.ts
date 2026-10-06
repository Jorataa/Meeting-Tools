/** Read JSON without buffering an unbounded request. Count decoded characters
 * so multilingual transcripts keep the same input allowance as English. */
export class BodyTooLarge extends Error {}
export async function boundedText(request: Request, limit: number): Promise<string> {
  // A UTF-8 code point takes at most three bytes per UTF-16 code unit.
  if (Number(request.headers.get('content-length')) > limit * 3) throw new BodyTooLarge();
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      text += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (text.length > limit) { await reader.cancel(); throw new BodyTooLarge(); }
      if (done) return text;
    }
  } finally { reader.releaseLock(); }
}
