// Stand-in for next/link: a plain anchor.
export default function Link({ href, prefetch, replace, scroll, ...rest }: any) {
  return <a href={typeof href === 'string' ? href : href?.pathname} {...rest} />
}
