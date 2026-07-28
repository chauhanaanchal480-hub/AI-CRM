import { BaseHttpAiProvider } from './BaseHttpAiProvider.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

/** Google Gemini provider (no SDK — native fetch). */
export class GeminiProvider extends BaseHttpAiProvider {
  readonly name = 'gemini';

  protected async call(system: string, user: string, maxTokens: number): Promise<string> {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `${system}\n\n${user}`,
                },
              ],
            },
          ],
          generationConfig: {
            maxOutputTokens: maxTokens,
          },
        }),
      }
    );

    if (!res.ok) {
      logger.error({ event: 'ai.provider_error', provider: this.name, status: res.status }, 'Gemini API error');
      throw new Error(`Gemini API error ${res.status}`);
    }

    const json = (await res.json()) as any;

    return (
      json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
    );
  }
}
