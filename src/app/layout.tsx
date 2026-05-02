import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MuttMind',
  description: 'Collaborative intelligence capture and network graph foundation.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
