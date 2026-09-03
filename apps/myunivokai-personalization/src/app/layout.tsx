import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import { Toaster } from "sonner";
import { AccountMenu } from "@/features/identity/AccountMenu";
import { gatewayOriginUrl } from "@/lib/gateway";
import "./globals.css";

// The Vietnamese subset is not decoration: the footer credit carries ầ, Đ, ă and
// ấ, and a latin-only unicode-range drops them onto whatever the OS supplies —
// a different face, mid-word, in the one line that names a person.
const inter = Inter({ subsets: ["latin", "vietnamese"], variable: "--font-inter" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" });
const jetBrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" });

// The header and the footer are both fixed and both 57px tall (the
// --header-height / --footer-height contract in globals.css). Pages render
// full-bleed *behind* both, so the 3D world runs edge to edge and the chrome
// frames it; floating chrome offsets itself by those heights and scrolling
// pages add their own top and bottom padding to clear them.
//
// Both bars are pointer-transparent except on their own controls. They are
// nearly invisible over a live world now, and a full-width bar that silently
// ate orbit-drags — and, before this, the create page's own toggle — is not a
// bar the user can see any reason for. The toggle could not simply outrank the
// header with a z-index: app/template.tsx wraps every page in an opacity
// animation, which creates a stacking context, so page content can never rise
// above sibling chrome no matter what z-index it asks for.
const COPYRIGHT_YEAR = 2026;

// Read from CSS rather than restated as a number, so this stack and
// components/Toast.tsx cannot end up in two different places. sonner writes a
// string offset straight into its own --offset-top, so a var() passes through.
const TOAST_TOP_INSET = "var(--toast-inset-top)";

export const metadata: Metadata = {
  title: "Myunivokai",
  description: "Personal 3D universe generator"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable} ${jetBrainsMono.variable}`}>
      <body>
        <div className="relative flex min-h-screen flex-col">
          {/* Floating gallery deck: warm-black Liquid Glass with a faint brass
              bottom edge. Height must stay 57px (HEADER_OFFSET_PIXELS contract). */}
          {/* Opaque and blurred below lg, all but transparent from lg up. From lg
              the page insets itself between the two bars and nothing ever passes
              behind them except the world, which is what the near-transparent
              treatment is for. Below lg the page is an ordinary scrolling
              document that runs underneath, and at 10% opacity with no blur the
              panel text came straight through the wordmark. */}
          <header className="immersive-exit immersive-exit-up chrome-bar pointer-events-none fixed top-0 z-50 w-full border-b border-hairline bg-mount/80 backdrop-blur-xl backdrop-saturate-[1.25] lg:bg-mount/10 lg:backdrop-blur-none">
            <div className="mx-auto flex w-full max-w-container-max items-center justify-between px-margin-mobile py-3 md:px-margin-desktop">
              <Link
                href="/"
                className="pointer-events-auto flex items-center gap-2 font-display text-xl font-semibold tracking-normal text-paper"
              >
                {/* `unoptimized` because the source is an SVG: the image
                    optimizer refuses those without dangerouslyAllowSVG, and a
                    1KB vector has nothing to optimise anyway. Empty alt — the
                    wordmark beside it already names the link. */}
                <Image src="/logo.svg" alt="" width={24} height={24} unoptimized priority />
                {/* The mark alone below `sm`, and this is a fix rather than a
                    tidy-up: at 375px the wordmark, Gallery, the identity
                    control and Create World needed about 440px of a 375px bar,
                    so they overlapped each other — worst when somebody is
                    signed in and the identity control carries a name.
                    `sr-only` rather than `hidden`, so the link keeps its
                    accessible name when only the 24px mark is visible. */}
                <span className="sr-only sm:not-sr-only">Myunivokai</span>
              </Link>
              <nav className="pointer-events-auto flex items-center gap-3 sm:gap-6">
                <Link
                  href="/gallery"
                  className="font-mono text-xs uppercase tracking-widest text-on-surface-variant transition hover:text-secondary"
                >
                  Gallery
                </Link>
                {/* External: the Go gateway's route index (origin derived from
                    NEXT_PUBLIC_GATEWAY_BASE_URL — never hardcoded). Hidden on the
                    narrowest screens so the 57px header never wraps. */}
                <a
                  href={gatewayOriginUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Myunivokai API Gateway"
                  className="hidden font-mono text-xs uppercase tracking-widest text-on-surface-variant transition hover:text-secondary sm:inline"
                >
                  API
                </a>
                {/* Renders nothing until the client has read the session
                    cookies, which is why it sits before Create World rather
                    than after: an element that appears late must not push a
                    control the visitor was already aiming at. */}
                <AccountMenu />
                <Link
                  href="/"
                  className="focus-ring btn-gradient whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold"
                >
                  Create World
                </Link>
              </nav>
            </div>
          </header>

          <div className="flex-1">{children}</div>

          {/* Fixed and slim, mirroring the header: the world runs underneath it
              so the chrome frames the scene instead of ending it. It used to be
              a tall in-flow band, which put a hard edge across the bottom of
              every full-bleed page and left the 3D stopping short of the
              viewport. Its rows collapse to one line so 57px is enough at every
              width — the copyright sentence is the part that would have
              wrapped, so it hides on the narrowest screens. */}
          <footer className="immersive-exit chrome-bar pointer-events-none fixed bottom-0 z-50 w-full border-t border-hairline bg-void/80 backdrop-blur-xl backdrop-saturate-[1.25] lg:bg-void/10 lg:backdrop-blur-none">
            <div className="mx-auto flex w-full max-w-container-max items-center justify-between gap-4 px-margin-mobile py-3 md:px-margin-desktop">
              <span className="pointer-events-auto font-display text-base font-semibold text-paper">Myunivokai</span>
              <span className="pointer-events-auto hidden font-body text-xs text-on-surface-variant sm:inline">
                © {COPYRIGHT_YEAR} Myunivokai — turn your personality into a living 3D world.
              </span>
              {/* A name, so not the mono uppercase treatment the build stage
                  label used: wide-tracked caps mangle Vietnamese diacritics. */}
              <span className="pointer-events-auto whitespace-nowrap font-body text-xs text-secondary">
                Trần Đăng Tuấn
              </span>
            </div>
          </footer>
        </div>

        {/* Liquid-Glass toasts: brief, auto-dismissing, cleared below the 57px
            header. Styled in globals.css (.lg-toast).

            The top inset is the CSS variable and not the 72px it used to be
            written as, because components/Toast.tsx is a second toast surface
            and the two have to appear in the same place — a save confirmation
            that lands somewhere a share confirmation never does reads as a
            different kind of message. Only `top` is set: this stack is
            centred, so its left and right insets decide nothing and are left
            at sonner's own default. */}
        <Toaster
          position="top-center"
          theme="dark"
          duration={2600}
          offset={{ top: TOAST_TOP_INSET }}
          mobileOffset={{ top: TOAST_TOP_INSET }}
          toastOptions={{ className: "lg-toast" }}
        />
      </body>
    </html>
  );
}
