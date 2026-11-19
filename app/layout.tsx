import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Thermal Printer Emulator',
  description: 'Virtual 80mm ESC/POS network printers',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
