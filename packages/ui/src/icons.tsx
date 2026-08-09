import type { ReactNode } from 'react'

export interface IconProps {
  size?: number
}

function Svg({ size = 16, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

export function IconSend(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.2 8 13.8 2.6 11 13.4 7.6 9.6z" strokeLinejoin="round" />
      <path d="M7.6 9.6 13.8 2.6" />
    </Svg>
  )
}

export function IconStop(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" stroke="none" />
    </Svg>
  )
}

/** gear: opens the shared BYOK settings dialog from every app's AI panel header */
export function IconAiSettings(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="2.1" />
      <path d="M8 1.6h0l.5 1.6a5 5 0 0 1 1.5.6l1.5-.8 1.5 1.5-.8 1.5c.3.5.5 1 .6 1.5l1.6.5v2.1l-1.6.5a5 5 0 0 1-.6 1.5l.8 1.5-1.5 1.5-1.5-.8a5 5 0 0 1-1.5.6L8 14.4h-.1l-.5-1.6a5 5 0 0 1-1.5-.6l-1.5.8-1.5-1.5.8-1.5a5 5 0 0 1-.6-1.5l-1.6-.5V7l1.6-.5c.1-.5.3-1 .6-1.5l-.8-1.5 1.5-1.5 1.5.8c.5-.3 1-.5 1.5-.6z" strokeLinejoin="round" />
    </Svg>
  )
}

/**
 * Neutral AI mark: a sparkle in a rounded badge, drawn in `currentColor`.
 *
 * Replaces the upstream Genspark brand mark wherever it was user-visible (each
 * app's AI panel header, the collapsed rail button, the ribbon AI group), so
 * the BYOK build carries no vendor branding for a service it does not call.
 */
export function IconAiMark(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1.3" y="1.3" width="13.4" height="13.4" rx="3.2" />
      <path
        d="M6.6 3.9 7.5 6.4 10 7.3 7.5 8.2 6.6 10.7 5.7 8.2 3.2 7.3 5.7 6.4z"
        fill="currentColor"
        stroke="none"
      />
      <path
        d="M11 8.6l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z"
        fill="currentColor"
        stroke="none"
      />
    </Svg>
  )
}

/** return/enter arrow (↵) for the icon-only send button */
export function IconEnter(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13 3.5v4a2.5 2.5 0 0 1-2.5 2.5H3.5" />
      <path d="M6.5 7 3.5 10l3 3" />
    </Svg>
  )
}
