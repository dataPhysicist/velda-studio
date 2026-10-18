// Smallest possible worker: proves a worker bundled into studio.js starts inside the Toolbelt iframe.
self.onmessage = (e: MessageEvent) => {
  const n = Number(e.data) || 0
  let s = 0
  for (let i = 0; i < n; i++) s += i
  ;(self as unknown as Worker).postMessage({ sum: s, at: Date.now() })
}
