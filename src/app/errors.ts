// Errors in plain words (06 section 8): what happened and what to do next, never a stack trace or a
// tool name. The raw message still goes to the console for the build log.
export function plainError(e: unknown): string {
  const raw = String((e as Error)?.message ?? e ?? '')
  console.warn('[studio]', raw)
  if (/timed? ?out|timeout|did not answer|no response/i.test(raw)) return 'Velda did not answer in time; try again in a minute'
  if (/Failed to execute public tool|not available|unknown tool|tool .* not found/i.test(raw)) return 'this page cannot reach that part of Toolbelt right now'
  if (/Failed to fetch|NetworkError|network|ECONN|disconnected/i.test(raw)) return 'the connection dropped; check you are online and try again'
  if (/quota|rate limit|429/i.test(raw)) return 'too many requests at once; wait a minute and try again'
  if (/payment|billing|insufficient|credit/i.test(raw)) return 'the image service needs its account looked at'
  if (/Upload failed|upload/i.test(raw)) return 'the file could not be saved to your workspace'
  if (/needs Toolbelt/i.test(raw)) return 'this needs the Toolbelt page'
  // Short messages the app wrote itself are already plain; anything else is cut down.
  const clean = raw.replace(/\b(mcp__|toolbelt_|create_sub_chat|execute_code|TOOLBELT_[A-Z_]+)\S*/g, '').replace(/\s+at\s.*$/s, '').trim()
  return clean && clean.length < 120 ? clean.replace(/\.$/, '') : 'something went wrong; try again'
}
