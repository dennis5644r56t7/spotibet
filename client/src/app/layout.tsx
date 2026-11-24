import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Spotibet | Official Casino & Aviator Platform',
  description: 'Welcome to Spotibet Casino. High-concurrency Aviator crash game, European Roulette, Blackjack, Mines & Slots. Licensed by BCLB Kenya.',
  icons: {
    icon: '/spotibet-logo.png',
    apple: '/spotibet-logo.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/spotibet-logo.png" />
        <link rel="apple-touch-icon" href="/spotibet-logo.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Montserrat:wght@700;800;900&family=JetBrains+Mono:wght@500;700;800&display=swap"
          rel="stylesheet"
        />
        {/* Paystack Inline Script (v2 — official popup checkout) */}
        <script src="https://js.paystack.co/v2/inline.js" async></script>
      </head>
      <body className="min-h-screen bg-[#07080c] text-[#c2cbda] antialiased selection:bg-[#dc1c34] selection:text-white font-sans overflow-x-hidden">
        {children}
      </body>
    </html>
  );
}
