import { BaseHttpAiProvider } from './BaseHttpAiProvider.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

/** OpenAI Chat Completions provider (no SDK — native fetch). */
export class OpenAiProvider extends BaseHttpAiProvider {
  readonly name = 'openai';

  protected async call(system: string, user: string, maxTokens: number): Promise<string> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) {
      logger.error({ event: 'ai.provider_error', provider: this.name, status: res.status }, 'OpenAI API error');
      throw new Error(`OpenAI API error ${res.status}`);
    }
    const json = (await res.json()) as { choices: { message: { content: string } }[] };
    return json.choices[0]?.message?.content?.trim() ?? '';
  }
}
