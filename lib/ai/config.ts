import 'server-only';

export function geminiKeys(): string[] {
 return [...new Set([
  ...Array.from({length: 5}, (_, index) => process.env[`GEMINI_API_KEY_${index + 1}`] || ''),
  process.env.GEMINI_API_KEY || '',
  ...(process.env.GEMINI_API_KEYS || '').split(','),
 ].map(key => key.trim()).filter(Boolean))];
}

export function geminiConfigured(): boolean {
 return geminiKeys().length > 0;
}

/** Preserve configured models while supporting projects without legacy model access. */
export function geminiMeetingModels(): string[] {
 return [...new Set([
  process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
 ])];
}
