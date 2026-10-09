import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans', display: 'swap' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });
export const metadata: Metadata = { title: 'Hush — your meeting, understood', description: 'Live meeting transcription, thoughtful clarifications, and clear notes in Indonesian, English, or both.' };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en" className={`${sans.variable} ${mono.variable}`}><body>{children}</body></html>; }
