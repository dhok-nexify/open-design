import { resolveEdition, type Edition } from '@open-design/contracts';

/**
 * OpenRouter attribution headers.
 *
 * The upstream build credits its own app id so OpenRouter can report usage.
 * The NexTore edition is delivered under the customer's identity and must not
 * advertise the upstream brand to a third party, so it sends no attribution
 * headers at all. Every BYOK/media request path reads this one helper, and an
 * upstream build keeps the exact headers it had before.
 */
export interface ProviderAttributionHeaders {
  'HTTP-Referer'?: string;
  'X-Title'?: string;
}

export function attributionHeadersForEdition(edition: Edition): ProviderAttributionHeaders {
  if (edition === 'nextore') return {};
  return {
    'HTTP-Referer': 'https://opendesign.dev',
    'X-Title': 'OpenDesign',
  };
}

export function providerAttributionHeaders(): ProviderAttributionHeaders {
  return attributionHeadersForEdition(resolveEdition(process.env.OD_EDITION));
}
