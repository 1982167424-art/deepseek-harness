import { clientBundle } from '../tsdown.client.ts'

const config = clientBundle('@deepseek-ai/dsh-client-ui-reasoning-translation', ['lib/types/index.js'])

export default (inlineConfig: Parameters<typeof config>[0]) => {
  const result = config(inlineConfig)
  for (const entry of result) {
    if (entry.name === '@deepseek-ai/dsh-client-ui-reasoning-translation/client') {
      (entry.entry as Record<string, string>).client = 'src/client/index.tsx'
    }
  }
  return result
}
