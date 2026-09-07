import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: {
    default: 'Tradewave · Real estate investment',
    template: '%s',
  },
  description:
    'Tradewave pools investor capital into vetted, freehold Dubai real estate.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      style={{ ['--font-sans' as string]: 'var(--font-geist-sans)' }}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
