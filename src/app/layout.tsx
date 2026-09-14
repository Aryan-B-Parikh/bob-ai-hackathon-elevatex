import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PortFlow SBX — San Pedro Bay Congestion Predictor & Operations Optimiser",
  description:
    "Container congestion prediction, berth/crane optimisation, alternate routing and 72-hour operations planning for the Ports of Long Beach / Los Angeles. Bob AI Hackathon L1 submission.",
  keywords: [
    "port congestion",
    "berth allocation",
    "crane optimisation",
    "San Pedro Bay",
    "Port of Long Beach",
    "72-hour operations plan",
    "Bob AI",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground min-h-screen flex flex-col`}
      >
        {/* ThemeProvider (in Providers) owns the html.dark class via next-themes.
            Toaster sits inside it so sonner toasts follow the active theme. */}
        <Providers>
          {children}
          <Toaster position="bottom-right" />
        </Providers>
      </body>
    </html>
  );
}
