// Replicate jobs run through a Velda sub-chat: the page cannot call Replicate directly, but Velda has
// the Replicate service connected and reads each model's input schema itself.
import type { ToolbeltSDK } from '../toolbelt'

export const MODELS = {
  reconstruct: 'vufinder/map-anything', // metric point cloud + camera poses from photos or video (Apache weights)
  photoreal: 'google/nano-banana-2', // image editing with references
  photorealBest: 'google/nano-banana-pro',
  to3d: 'tencent/hunyuan-3d-3.1', // product photo -> textured GLB
}

export type ReplicateResult = { status: string; output: any; error: string | null }

export async function runReplicate(
  sdk: ToolbeltSDK,
  model: string,
  input: Record<string, unknown>,
  opts: { timeoutSeconds?: number; note?: string } = {},
): Promise<ReplicateResult> {
  const prompt = `Run one Replicate prediction and report the result. Use only your Replicate tools.

Model: ${model}
Input (JSON): ${JSON.stringify(input)}
${opts.note ? `Notes: ${opts.note}\n` : ''}
Steps:
1. Read the model with the Replicate get-model tool (collectionSlug = the owner, modelId = "${model}"). Take latest_version.id as the version. If a field name in the input above does not exist in its schema, map it onto the real field (keep the values; image lists stay lists).
2. Create the prediction with the create-prediction tool (collectionSlug = the owner, modelId = "${model}", version = that id, input = the JSON as a string), then check it with the get-prediction tool until its status is succeeded, failed or canceled. Wait between checks.
3. Reply with ONLY one JSON object and nothing else:
{"status": "succeeded" or "failed", "output": <the prediction's output exactly as returned, URLs unchanged>, "error": <error text or null>}`
  const raw = await sdk.ask(prompt, 'claude-sonnet-4-6', opts.timeoutSeconds ?? 300)
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('Replicate run did not return a result')
  const res = JSON.parse(raw.slice(start, end + 1)) as ReplicateResult
  if (res.status !== 'succeeded') throw new Error(res.error || `Replicate run ${res.status}`)
  return res
}

/** Every URL inside a Replicate output (string, array or nested object). */
export function outputUrls(output: any): string[] {
  const out: string[] = []
  const walk = (v: any) => {
    if (typeof v === 'string' && /^https?:\/\//.test(v)) out.push(v)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(output)
  return out
}
