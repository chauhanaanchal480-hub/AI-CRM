import { BaseHttpAiProvider } from './BaseHttpAiProvider.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

/** Anthropic Messages API provider (no SDK — native fetch). */
export class AnthropicAiProvider extends BaseHttpAiProvider {
  readonly name = 'anthropic';

  protected async call(system: string, user: string, maxTokens: number): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) {
      logger.error({ event: 'ai.provider_error', provider: this.name, status: res.status }, 'Anthropic API error');
      throw new Error(`Anthropic API error ${res.status}`);
    }
    const json = (await res.json()) as { content: { type: string; text: string }[] };
    return json.content.map((c) => c.text ?? '').join('').trim();
  }
}
