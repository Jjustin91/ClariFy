import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { ClarifyProvider } from '@/src/context/ClarifyContext';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-plus-jakarta',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ClariFy — USTP Unified Campus Noticeboard & Scoped Communication Platform',
  description:
    'Unified Campus Noticeboard, Scoped Course Hubs, Isolated Q&A Threads, 1-Click Anonymized Class FAQs, and PRISMS Admin Console for USTP-CDO (IT314 Group 5).',
  openGraph: {
    title: 'ClariFy — USTP Unified Campus Noticeboard & Scoped Communication Platform',
    description:
      'Unified Campus Noticeboard, Scoped Course Hubs, Isolated Q&A Threads, 1-Click Anonymized Class FAQs, and PRISMS Admin Console for USTP-CDO (IT314 Group 5).',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClariFy — USTP Unified Campus Noticeboard & Scoped Communication Platform',
    description:
      'Unified Campus Noticeboard, Scoped Course Hubs, Isolated Q&A Threads, 1-Click Anonymized Class FAQs, and PRISMS Admin Console for USTP-CDO (IT314 Group 5).',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plusJakarta.variable} ${jetbrainsMono.variable}`}>
      <body
        suppressHydrationWarning
        className="font-sans bg-ustp-cream text-ustp-text antialiased selection:bg-ustp-gold selection:text-ustp-navy"
      >
        <ClarifyProvider>{children}</ClarifyProvider>
      </body>
    </html>
  );
}

