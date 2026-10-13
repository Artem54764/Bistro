import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Header from './components/Header';

export const metadata: Metadata = { title: 'Trzcina Bistro — zamówienia' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pl">
      <body><Header />{children}</body>
    </html>
  );
}
