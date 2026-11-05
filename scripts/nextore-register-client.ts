/**
 * Registers the NexTore Designer as an OAuth client on a NexTore site.
 *
 * NexTore's OAuthServerModule exposes RFC 7591 dynamic registration at
 * /oauth/register. Registration is fail-closed behind the module's
 * "Allowed Return Address Patterns" setting, so the redirect_uri this script
 * sends must already be on that list.
 *
 * Usage:
 *   node --experimental-strip-types scripts/nextore-register-client.ts \
 *     --nextore https://v4.nexify.hk \
 *     --redirect http://10.68.150.145:8888/auth/callback
 *
 * Optional:
 *   --name "NexTore Designer"   client_name shown on the approval page
 *   --json                      machine-readable output only
 *
 * The printed client_id goes into the Designer module's settings page
 * (Designer -> Settings -> Connection -> OAuth Client ID) and into the daemon's
 * NEXTORE_OAUTH_CLIENT_ID environment variable.
 */

interface Options {
  nextore: string;
  redirect: string;
  name: string;
  json: boolean;
}

function fail(message: string): never {
  process.stderr.write(message + '\n');
  process.exit(1);
}

function parseOptions(argv: string[]): Options {
  const values = new Map<string, string>();
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === '--json') {
      json = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      process.stdout.write('node --experimental-strip-types scripts/nextore-register-client.ts --nextore <origin> --redirect <callback-url> [--name <label>] [--json]\n');
      process.exit(0);
    }
    if (!token.startsWith('--')) fail('Unexpected argument: ' + token);

    const flag = token.slice(2);
    if (flag !== 'nextore' && flag !== 'redirect' && flag !== 'name') {
      fail('Unknown option: ' + token);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail('Missing value for ' + token);
    values.set(flag, value);
    index += 1;
  }

  const nextore = values.get('nextore');
  const redirect = values.get('redirect');
  if (!nextore) fail('--nextore is required (for example https://v4.nexify.hk).');
  if (!redirect) fail('--redirect is required (for example http://10.68.150.145:8888/auth/callback).');

  return { nextore, redirect, name: values.get('name') ?? 'NexTore Designer', json };
}

function origin(value: string, flag: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail(flag + ' must be an absolute URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    fail(flag + ' must use http or https.');
  }
  if (parsed.search || parsed.hash) fail(flag + ' must not contain a query string or fragment.');
  if (parsed.username || parsed.password) fail(flag + ' must not contain embedded credentials.');
  return parsed.origin + parsed.pathname.replace(/\/+$/, '');
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const site = origin(options.nextore, '--nextore');
  const redirect = origin(options.redirect, '--redirect');

  const endpoint = site + '/oauth/register';
  const body = {
    client_name: options.name,
    redirect_uris: [redirect],
    token_endpoint_auth_method: 'none',
    scope: 'mcp:tools',
  };

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    fail('Could not reach ' + endpoint + ': ' + (error instanceof Error ? error.message : String(error)));
  }

  const text = await response.text();
  let payload: Record<string, unknown> | null = null;
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const description =
      (payload && typeof payload.error_description === 'string' && payload.error_description) ||
      text.slice(0, 400) ||
      'no response body';
    const code = payload && typeof payload.error === 'string' ? payload.error : String(response.status);
    fail('Registration refused (' + code + '): ' + description);
  }

  const clientId = payload && typeof payload.client_id === 'string' ? payload.client_id : '';
  if (!clientId) fail('Registration returned no client_id: ' + text.slice(0, 400));

  if (options.json) {
    process.stdout.write(JSON.stringify({ client_id: clientId, redirect_uris: [redirect] }) + '\n');
    return;
  }

  process.stdout.write(
    [
      'Registered ' + options.name,
      '  client_id      ' + clientId,
      '  redirect_uri   ' + redirect,
      '',
      'Use it in both places:',
      '  Designer module : Settings -> Connection -> OAuth Client ID',
      '  Designer daemon : NEXTORE_OAUTH_CLIENT_ID=' + clientId,
      '',
    ].join('\n'),
  );
}

await main();
