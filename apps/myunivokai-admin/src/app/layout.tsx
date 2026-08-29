import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/components/providers/query-provider";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "vietnamese"], variable: "--font-inter" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" });
const jetBrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" });

export const metadata: Metadata = {
  title: "Myunivokai Admin",
  description: "Internal staff console",
  // Staff-only surface: never indexed, never listed, never statically
  // generated with record data (notes/plans/services/auth-and-admin-plan.md#the-admin-app).
  robots: { index: false, follow: false }
};

// No page-transition wrapper at this level on purpose: it used to sit above
// (dashboard)/layout.tsx and re-animate the sidebar and header on every nav
// click along with the content. The transition that survives lives inside
// that layout instead, scoped to just the content pane.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${spaceGrotesk.variable} ${jetBrainsMono.variable} h-full`}>
      <body className="flex min-h-full flex-col antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
          <QueryProvider>
            {children}
            <Toaster theme="dark" position="top-center" />
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

