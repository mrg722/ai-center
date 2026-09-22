import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Command Center',
  description: 'Multi-agent command center: coordinate Claude, GPT/Codex, Gemini and more — with a human moderator in charge.',
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#07090d',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
