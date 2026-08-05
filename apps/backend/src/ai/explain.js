import { generateTemplateExplanation } from './template-fallback.js';
import { AI_EXPLAINER_TIMEOUT_MS } from '../../../../packages/domain/src/thresholds.js';

/**
 * @file explain.js
 * 
 * Provides a minimal AI explanation of an incident using the Anthropic API.
 * 
 * Constraints:
 * 1. Single paragraph output only.
 * 2. 3-second strict timeout limit.
 * 3. Falls back deterministically if timeout, error, or no API key.
 * 4. STRICTLY PROHIBITS hallucinating physics, weather, or electrical specifics not found in the JSON.
 */

export async function explainIncident(incident) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return generateTemplateExplanation(incident);
  }

  const prompt = `You are an operational assistant for a smart power grid.
I will provide you with a JSON object representing a localized grid fault (an "Incident").
Your task is to write EXACTLY ONE concise paragraph summarizing the incident for a human operator.

STRICT RULES:
1. You MUST output EXACTLY ONE paragraph. No bullet points, no markdown formatting, no lists.
2. DO NOT invent or hallucinate physical, environmental, or electrical details. For example, do NOT mention weather, lightning, falling trees, exact impedance values, or voltage spikes unless those specific words exist in the JSON.
3. Simply state the fault type, the number of affected poles, and its current status based on the data.
4. Keep the tone professional, objective, and urgent if the state is DETECTED.

Incident JSON:
${JSON.stringify(incident, null, 2)}
`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_EXPLAINER_TIMEOUT_MS);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[AI Explain] Anthropic API returned ${response.status}. Using fallback.`);
      return generateTemplateExplanation(incident);
    }

    const data = await response.json();
    
    if (data && data.content && data.content.length > 0) {
      return data.content[0].text.trim();
    }
    
    return generateTemplateExplanation(incident);
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn(`[AI Explain] Request timed out after ${AI_EXPLAINER_TIMEOUT_MS}ms. Using fallback.`);
    } else {
      console.error('[AI Explain] Network or unhandled error:', error.message);
    }
    return generateTemplateExplanation(incident);
  }
}
