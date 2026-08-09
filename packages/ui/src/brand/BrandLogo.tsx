import type { CSSProperties, ImgHTMLAttributes } from 'react'

const WORDMARKS = {
  amber: new URL('./assets/captivela-wordmark-amber-2363x715.png', import.meta.url).href,
  blue: new URL('./assets/captivela-wordmark-blue-2363x715.png', import.meta.url).href,
  ink: new URL('./assets/captivela-wordmark-ink-2363x715.png', import.meta.url).href,
  white: new URL('./assets/captivela-wordmark-white-2363x715.png', import.meta.url).href,
} as const

export type BrandLogoVariant = keyof typeof WORDMARKS

export interface BrandLogoProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  'alt' | 'height' | 'src' | 'width'
> {
  /** Accessible name. Use an empty string only when the same name is adjacent in text. */
  alt?: string
  variant?: BrandLogoVariant
  className?: string
  style?: CSSProperties
}

/**
 * Official horizontal Captivela wordmark.
 *
 * The brand minimum is 96 CSS pixels wide. The base class enforces that minimum
 * whenever its container can accommodate it, while still allowing responsive
 * shrinking in narrower containers.
 */
export function BrandLogo({
  alt = 'Captivela',
  variant = 'blue',
  className,
  style,
  ...props
}: BrandLogoProps) {
  const classes = ['captivela-brand-logo', className].filter(Boolean).join(' ')

  return (
    <img
      {...props}
      alt={alt}
      className={classes}
      decoding="async"
      draggable={false}
      src={WORDMARKS[variant]}
      style={style}
    />
  )
}
