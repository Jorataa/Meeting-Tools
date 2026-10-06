import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Hush — your meeting, understood', description: 'Live meeting transcription, thoughtful clarifications, and clear notes in Indonesian, English, or both.' };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
