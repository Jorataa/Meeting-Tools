'use client';

import { useEffect, useRef, useState } from 'react';
import { FileAudio, Upload } from 'lucide-react';

export function AudioDropzone({ enabled, onFile }: { enabled: boolean; onFile: (file: File) => void }) {
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState('');
  const selectFile = useRef(onFile);
  selectFile.current = onFile;
  useEffect(() => {
    setDragging(false);
    let depth = 0;
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types || []).includes('Files');
    const enter = (event: DragEvent) => { if (!hasFiles(event)) return; event.preventDefault(); if (!enabled) return; depth++; setDragging(true); const name = event.dataTransfer?.files[0]?.name; if (name) setPreview(name); };
    const over = (event: DragEvent) => { if (!hasFiles(event)) return; event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = enabled ? 'copy' : 'none'; };
    const leave = (event: DragEvent) => { if (!hasFiles(event)) return; depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const reset = () => { depth = 0; setDragging(false); setPreview(''); };
    const drop = (event: DragEvent) => { if (!hasFiles(event)) return; event.preventDefault(); reset(); const file = event.dataTransfer?.files[0]; if (file && enabled) selectFile.current(file); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') reset(); };
    window.addEventListener('dragenter', enter); window.addEventListener('dragover', over); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop); window.addEventListener('blur', reset); window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); window.removeEventListener('blur', reset); window.removeEventListener('keydown', escape); };
  }, [enabled]);
  return dragging && enabled ? <div className="audio-dropzone" role="status" aria-live="polite"><div><span className="welcome-orbit"><Upload size={36} aria-hidden="true" /></span><h2>Drop it. We’ll take it from here.</h2><p>Your recording, a clear transcript, and all the next steps.</p><span className="drop-file"><FileAudio size={17} aria-hidden="true" />{preview || 'MP3, M4A, WAV, WebM, or OGG · Up to 12 MB'}</span><small>Release to preview your audio</small></div></div> : null;
}
