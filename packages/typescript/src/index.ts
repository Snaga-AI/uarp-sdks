/**
 * uarp-sdk — TypeScript/Node client for the UARP (Snaga) platform.
 *
 * ```ts
 * import { UarpClient } from 'uarp-sdk';
 *
 * const client = new UarpClient({ apiKey: process.env.UARP_API_KEY });
 * const agents = await client.agents.list({ limit: 20 });
 * ```
 */
import { DEFAULT_BASE_URL, SDK_VERSION } from './generated/meta.js';
import { createResources, type Resources } from './generated/resources/index.js';
import { Transport, type ClientOptions, type RequestOptions, type RequestSpec } from './core/transport.js';

/** Version of this SDK, kept in step with the repository VERSION file. */
export const VERSION = SDK_VERSION;

/** Declaration merging gives the client every generated resource accessor. */
export interface UarpClient extends Resources {}

export class UarpClient {
  /** Low-level transport; use it for endpoints the SDK has not surfaced yet. */
  readonly transport: Transport;

  constructor(options: ClientOptions = {}) {
    this.transport = new Transport(options, {
      baseURL: DEFAULT_BASE_URL,
      userAgent: `uarp-sdk-typescript/${VERSION}`,
    });
    Object.assign(this, createResources(this.transport));
  }

  /** The base URL every request is resolved against. */
  get baseURL(): string {
    return this.transport.baseURL;
  }

  /** Escape hatch: issue an arbitrary request through the configured transport. */
  request<T = unknown>(spec: RequestSpec): Promise<T> {
    return this.transport.request<T>(spec);
  }
}

export default UarpClient;

export { Transport };
export type { ClientOptions, RequestOptions, RequestSpec };
export { DEFAULT_BASE_URL, SPEC_VERSION, SCOPES, type Scope } from './generated/meta.js';
export * from './core/errors.js';
export type { BinaryInput, FileInput, JsonObject, JsonValue, JsonPrimitive } from './core/json.js';
export { EventStream, parseEventStream, type EventStreamOptions, type UarpEvent } from './core/sse.js';
export { autoPaginate, collect, type CursorPage } from './core/pagination.js';
export { APIResource } from './core/resource.js';
export * from './generated/models.js';
export * from './generated/resources/index.js';
