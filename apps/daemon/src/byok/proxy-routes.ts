import type { Express, Request, Response } from 'express';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { ByokProxyRegistry } from './proxy-registry.js';

/**
 * Byte-level reverse proxy for the agent's model traffic (NXD-P01, path A).
 *
 * It deliberately does not understand any provider protocol: the agent keeps
 * speaking whatever its provider package speaks, and this forwards the request
 * and the response stream unchanged. That keeps SSE streaming intact and means a
 * new provider needs no change here.
 *
 * Mounted before the JSON body parser and before the browser gate, because a
 * model call is a long-lived stream from a non-browser caller. The capability
 * token is the authorization; the destination comes from the registry, never
 * from the request.
 */
const HOP_BY_HOP = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/**
 * Joins the issued provider base URL with the path the agent asked for. The base
 * URL may carry its own query (an Azure `api-version`, for example), so plain
 * string concatenation would fold the caller's path into that query and send
 * the request somewhere else entirely.
 */
function buildUpstreamUrl(baseUrl: string, rest: string, query: string): URL {
  const base = new URL(baseUrl);
  const path = base.pathname.replace(/\/+$/, '') + rest;
  const params = new URLSearchParams(base.search);
  if (query.startsWith('?')) {
    for (const [name, value] of new URLSearchParams(query)) params.append(name, value);
  }
  const upstream = new URL(base.origin);
  upstream.pathname = path || '/';
  const search = params.toString();
  upstream.search = search ? `?${search}` : '';
  return upstream;
}

export function registerByokProxyRoutes(
  app: Express,
  deps: { registry: ByokProxyRegistry },
): void {
  app.all(/^\/api\/byok\/proxy\/([A-Za-z0-9_-]+)(\/.*)?$/u, (req: Request, res: Response) => {
    const match = /^\/api\/byok\/proxy\/([A-Za-z0-9_-]+)(\/.*)?$/u.exec(req.path);
    const token = match?.[1] ?? '';
    const rest = match?.[2] ?? '';
    const target = deps.registry.resolve(token);
    if (!target) {
      res.status(404).json({ error: 'proxy_target_unknown' });
      return;
    }

    const queryIndex = req.originalUrl.indexOf('?');
    const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : '';
    let upstream: URL;
    try {
      upstream = buildUpstreamUrl(target.baseUrl, rest, query);
    } catch {
      res.status(502).json({ error: 'proxy_target_invalid' });
      return;
    }

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (HOP_BY_HOP.has(name.toLowerCase())) continue;
      headers[name] = Array.isArray(value) ? value.join(', ') : String(value);
    }
    headers.host = upstream.host;

    const send = upstream.protocol === 'https:' ? httpsRequest : httpRequest;
    const proxied = send(
      upstream,
      { method: req.method, headers },
      (upstreamRes) => {
        res.status(upstreamRes.statusCode ?? 502);
        for (const [name, value] of Object.entries(upstreamRes.headers)) {
          if (value === undefined) continue;
          if (HOP_BY_HOP.has(name.toLowerCase())) continue;
          try {
            res.setHeader(name, value as string | string[]);
          } catch {
            // A header the response cannot carry must not fail the stream.
          }
        }
        upstreamRes.pipe(res);
      },
    );
    proxied.on('error', () => {
      if (!res.headersSent) res.status(502).json({ error: 'proxy_upstream_failed' });
      else res.end();
    });
    // The client hanging up must cancel the upstream, or a cancelled run would
    // keep a model stream open.
    res.on('close', () => {
      if (!res.writableEnded) proxied.destroy();
    });
    req.pipe(proxied);
  });
}
