'use client';

import { useCallback, useEffect, useState } from 'react';

export function useWorkspacePreferences(ownerId: string) {
  const [language, setLanguage] = useState<'auto' | 'en' | 'id'>('auto');
  const [frequency, setFrequency] = useState<'balanced' | 'minimal'>('balanced');
  const [summaryStyle, setSummaryStyle] = useState<'concise' | 'structured'>('concise');
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(`hush.prefs.${encodeURIComponent(ownerId)}`) || '{}');
      if (['auto', 'en', 'id'].includes(stored.language)) setLanguage(stored.language);
      if (['balanced', 'minimal'].includes(stored.frequency)) setFrequency(stored.frequency);
      if (['concise', 'structured'].includes(stored.summaryStyle)) setSummaryStyle(stored.summaryStyle);
    } catch { /* Defaults remain usable if storage is unavailable or malformed. */ }
  }, [ownerId]);
  const persist = useCallback((key: string, value: string) => {
    try {
      const storageKey = `hush.prefs.${encodeURIComponent(ownerId)}`;
      let previous: Record<string, unknown> = {};
      try { previous = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch { /* Repair malformed preferences. */ }
      localStorage.setItem(storageKey, JSON.stringify({ ...previous, [key]: value }));
    } catch { /* In-memory preferences remain usable. */ }
  }, [ownerId]);
  const updateLanguage = useCallback((value: 'auto' | 'en' | 'id') => { setLanguage(value); persist('language', value); }, [persist]);
  const updateFrequency = useCallback((value: 'balanced' | 'minimal') => { setFrequency(value); persist('frequency', value); }, [persist]);
  const updateSummaryStyle = useCallback((value: 'concise' | 'structured') => { setSummaryStyle(value); persist('summaryStyle', value); }, [persist]);
  return { language, frequency, summaryStyle, updateLanguage, updateFrequency, updateSummaryStyle };
}
