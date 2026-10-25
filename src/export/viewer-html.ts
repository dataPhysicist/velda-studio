// The share link's page (08 section 2): one HTML file with the shared schemes as JSON inside, the
// viewer bundle and three.js from jsDelivr, and nothing else. No Toolbelt calls: a share link must
// work for anyone, without an account.
import type { ViewerData } from '../viewer/data'

export const THREE_VERSION = '0.186.1'

export type ViewerHtmlOpts = {
  /** dist/viewer.js at the commit the studio was built from. */
  viewerUrl: string
  /** jsDelivr base for three, e.g. https://cdn.jsdelivr.net/npm/three@0.186.1 */
  threeBase?: string
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function viewerHtml(d: ViewerData, o: ViewerHtmlOpts): string {
  const three = o.threeBase ?? `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`
  const imports = { imports: { three: `${three}/build/three.module.js`, 'three/addons/': `${three}/examples/jsm/` } }
  // JSON inside a script element: "</" would end it, so it is written as "<\/".
  const json = JSON.stringify(d).replace(/<\//g, '<\\/').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  const title = `${d.project.name}: ${d.schemes.map((s) => s.name).join(', ')}`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<script type="importmap">${JSON.stringify(imports)}</script>
<style>html,body{margin:0;height:100%;background:#fbfbf8;color:#23282c;font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}#velda-viewer{height:100%}.boot{padding:40px;color:#737d83}</style>
</head>
<body>
<div id="velda-viewer"><p class="boot">Opening ${esc(d.project.name)}...</p></div>
<script id="velda-data" type="application/json">${json}</script>
<script type="module" src="${esc(o.viewerUrl)}"></script>
</body>
</html>
`
}
