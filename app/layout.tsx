import type {Metadata} from 'next';
import { Cairo } from 'next/font/google';
import './globals.css'; // Global styles

const cairo = Cairo({ subsets: ['latin', 'arabic'] });

export const metadata: Metadata = {
  title: 'MTProto Proxy Bot Dashboard',
  description: 'Manage your Telegram MTProto proxies',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="ar" dir="rtl">
      <body className={cairo.className} suppressHydrationWarning>{children}</body>
    </html>
  );
}
