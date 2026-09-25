export interface ShieldIconProps {
  size?: number
}

/** Brand mark: shield + check, reused by the PWA header and the extension
 * side panel's compact brand row (spec §4b: one accent color, calm icon). */
export function ShieldIcon({ size = 36 }: ShieldIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 2 4 5v6c0 5 3.4 8.7 8 9 4.6-.3 8-4 8-9V5l-8-3Z"
        fill="var(--color-accent)"
      />
      <path
        d="m9 12 2 2 4-4"
        stroke="var(--color-accent-contrast)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
