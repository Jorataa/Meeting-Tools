// Shared browser/server limits. Base64 plus instructions stays below Gemini's
// 20 MB inline request limit. Never split encoded MediaRecorder chunks blindly:
// they share container headers and aren't independently playable audio files.
export const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
export const MAX_RECORDING_SECONDS = 15 * 60;
export const AUDIO_ACCEPT = '.mp3,.wav,.m4a,.webm,.ogg,audio/mpeg,audio/wav,audio/mp4,audio/webm,audio/ogg';

const formats: Record<string, string> = {
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/m4a',
  webm: 'audio/webm', ogg: 'audio/ogg',
};
const aliases: Record<string, string> = {
  'audio/mp3': 'audio/mpeg', 'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav', 'audio/vnd.wave': 'audio/wav',
  'audio/mp4': 'audio/m4a', 'audio/x-m4a': 'audio/m4a',
  'application/ogg': 'audio/ogg',
};

export function audioMimeType(file: Pick<File, 'name' | 'type'>): string | null {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const expected = formats[extension];
  if (!expected) return null;
  const declared = file.type.split(';')[0].trim().toLowerCase();
  if (!declared || declared === 'application/octet-stream') return expected;
  return (aliases[declared] || declared) === expected ? expected : null;
}

export function validateAudio(file: Pick<File, 'name' | 'type' | 'size'>): string | null {
  if (!file.size) return 'This audio file is empty. Choose a recording with sound.';
  if (file.size > MAX_AUDIO_BYTES) return 'This audio is too large. Choose a file under 12 MB or a shorter recording.';
  if (!audioMimeType(file)) return "This audio format isn't supported. Choose MP3, WAV, M4A, WebM, or OGG.";
  return null;
}

// Check the actual container, not just the client-provided extension/MIME type.
export function hasAudioHeader(bytes: Uint8Array, mimeType: string): boolean {
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.subarray(start, start + length));
  if (bytes.length < 12) return false;
  switch (mimeType) {
    case 'audio/wav': return bytes.length > 44 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE';
    case 'audio/ogg': return ascii(0, 4) === 'OggS';
    case 'audio/webm': return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    case 'audio/m4a': return ascii(4, 4) === 'ftyp';
    case 'audio/mpeg': return ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    default: return false;
  }
}
