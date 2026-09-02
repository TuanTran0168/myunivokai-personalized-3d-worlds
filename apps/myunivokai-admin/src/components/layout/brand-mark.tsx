// The Myunivokai mark (an M drawn as a ridge, with a disc rising behind it —
// see apps/myunivokai-personalization/public/logo.svg for the full design rationale),
// reused verbatim rather than inventing a second symbol for this app. Inline
// rather than an <img> so it recolors with no extra asset request.
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" role="img" aria-label="Myunivokai" className={className}>
      <defs>
        <linearGradient id="myunivokai-admin-mark-ridge" x1="48" y1="120" x2="464" y2="424" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#E4CF9C" />
          <stop offset="0.55" stopColor="#C9A35B" />
          <stop offset="1" stopColor="#A8843F" />
        </linearGradient>
        <linearGradient id="myunivokai-admin-mark-disc" x1="300" y1="104" x2="404" y2="208" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#F2EEE6" />
          <stop offset="0.5" stopColor="#E4CF9C" />
          <stop offset="1" stopColor="#C9A35B" />
        </linearGradient>
      </defs>
      <circle cx="352" cy="156" r="66" fill="url(#myunivokai-admin-mark-disc)" />
      <polyline
        points="68,400 172,214 256,292 338,170 444,400"
        fill="none"
        stroke="url(#myunivokai-admin-mark-ridge)"
        strokeWidth="46"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
