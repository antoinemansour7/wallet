import OpenAI from 'openai'

export const OPENAI_RESEARCH_MODEL = process.env.OPENAI_RESEARCH_MODEL || 'gpt-5.4-mini-2026-03-17'

// Tests retain the already-mocked Anthropic path unless they explicitly opt in.
// Production defaults to OpenAI so an old Anthropic key cannot silently keep
// the paid ranking path on the wrong provider.
export function usesOpenAIResearch(env = process.env) {
  if (env.RESEARCH_MODEL_PROVIDER) return env.RESEARCH_MODEL_PROVIDER.toLowerCase() === 'openai'
  return env.NODE_ENV !== 'test'
}

function usageMetrics(usage = {}) {
  const inputUnits = Number(usage.input_tokens) || 0
  const outputUnits = Number(usage.output_tokens) || 0
  return {
    inputUnits,
    outputUnits,
    totalUnits: Number(usage.total_tokens) || inputUnits + outputUnits,
    // GPT-5.4 Mini standard pricing: $0.75/M input, $4.50/M output.
    estimatedCostUsd: Number((inputUnits * 0.75e-6 + outputUnits * 4.5e-6).toFixed(6)),
  }
}

export async function generateStructuredArray({
  name,
  description,
  itemSchema,
  instructions,
  input,
  // The account's TPM gate includes the reserved output budget. Four thousand
  // is ample for these compact schemas and keeps a request safely below Tier 1.
  maxOutputTokens = 4000,
  reasoningEffort = process.env.RESEARCH_EFFORT || 'medium',
  requestOptions,
}) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set')
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const response = await client.responses.create({
    model: OPENAI_RESEARCH_MODEL,
    instructions,
    input,
    max_output_tokens: maxOutputTokens,
    reasoning: { effort: reasoningEffort },
    text: {
      verbosity: 'low',
      format: {
        type: 'json_schema',
        name,
        description,
        strict: true,
        schema: {
          type: 'object',
          properties: { items: { type: 'array', items: itemSchema } },
          required: ['items'],
          additionalProperties: false,
        },
      },
    },
    store: false,
  }, requestOptions)
  if (response.status === 'incomplete') {
    throw new Error(`OpenAI response incomplete: ${response.incomplete_details?.reason || 'unknown reason'}`)
  }
  const parsed = JSON.parse(response.output_text)
  if (!Array.isArray(parsed.items)) throw new Error('OpenAI structured response did not contain an items array')
  console.log('[research-model] completion', {
    provider: 'openai',
    model: response.model || OPENAI_RESEARCH_MODEL,
    operation: name,
    ...usageMetrics(response.usage),
  })
  return parsed.items
}

export async function checkOpenAIResearchModel(requestOptions) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set')
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const response = await client.responses.create({
    model: OPENAI_RESEARCH_MODEL,
    input: 'Reply with exactly OK.',
    max_output_tokens: 64,
    reasoning: { effort: 'none' },
    text: { verbosity: 'low' },
    store: false,
  }, requestOptions)
  return { provider: 'openai', model: response.model || OPENAI_RESEARCH_MODEL, text: response.output_text, ...usageMetrics(response.usage) }
}
