# Audio test fixtures

- `english.wav`: Google's public speech sample, asking "How old is the Brooklyn
  Bridge?" Source: https://storage.googleapis.com/cloud-samples-data/speech/brooklyn_bridge.wav
- `microphone.wav`: the same speech converted to canonical mono 48 kHz PCM WAV
  for Chromium's file-backed test microphone.
- `indonesian.mp3`: synthesized Indonesian speech: "Selamat pagi. Rapat dimulai
  pukul sembilan. Anggaran proyek lima juta rupiah."
- `mixed.mp3`: synthesized mixed-language speech: "Besok kita review API dan
  database. The deadline is Friday. Tolong kirim update sebelum jam lima."

- `deadline.mp3`: synthetic Indonesian commitment with an unresolved launch
  date; used by the full live interruption test.
- `deadline-answer.mp3`: synthetic participant answer setting 15 November 2026
  as the deadline and naming Rina as the owner.

The MP3 clips were generated through Google's public translate TTS endpoint for
these test sentences. They contain no private meeting content. Live quality
checks allow natural punctuation and numeric formatting, and check that the
spoken language and important details survive transcription.
