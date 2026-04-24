import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Movie Streaming",
  description: "High performance streaming frontend",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <meta name="theme-color" content="#000000" />
        <link rel="preconnect" href="https://huggingface.co" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://xkca.dadalapathy756.workers.dev" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://huggingface.co" />
        <link rel="dns-prefetch" href="https://xkca.dadalapathy756.workers.dev" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-black`}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}