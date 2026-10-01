// Stand-in for next/image: a plain <img>. Root-absolute paths are Pascal static assets.
declare const __STUDIO_ASSET_BASE__: string
const resolve = (s: unknown) =>
  typeof s === 'string' && s.startsWith('/') && !s.startsWith('//') ? __STUDIO_ASSET_BASE__ + s : s

export default function Image({ src, alt, fill, priority, unoptimized, loader, quality, placeholder, blurDataURL, style, ...rest }: any) {
  const url = resolve(typeof src === 'string' ? src : src?.src)
  const fillStyle = fill ? { position: 'absolute', inset: 0, width: '100%', height: '100%' } : null
  return <img alt={alt ?? ''} src={url as string} {...rest} style={{ ...fillStyle, ...style }} />
}
