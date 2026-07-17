import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { brandTokens } from '@/lib/brand-tokens';
import './globals.css';

export const metadata: Metadata = {
  title: brandTokens.copy.name,
  description: brandTokens.copy.description
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body className="balance-app">{children}</body>
    </html>
  );
}
