import { encode } from 'gpt-tokenizer'

export interface TokenSavingsEstimate {
  injected: number
  baseline: number
  saved: number
  low: number
  high: number
}

/**
 * Approximate token count using gpt-tokenizer's generic GPT encoding.
 * This is still an estimate: MCP agents that self-report provider usage can
 * supply actual numbers, and Mindr stores those separately.
 */
export function estimateTokens(text: string): number {
  return encode(text).length
}

export function estimateSavings(tokensInjected: number, sourceTexts: string[]): TokenSavingsEstimate {
  const baseline = sourceTexts.reduce((sum, text) => sum + estimateTokens(text), 0)
  const saved = Math.max(0, baseline - tokensInjected)
  return {
    injected: tokensInjected,
    baseline,
    saved,
    low: Math.max(0, Math.round(saved * 0.7)),
    high: Math.round(saved * 1.3),
  }
}
