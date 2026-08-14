/** Base class every generated resource group extends. */
import type { Transport } from './transport.js';

export class APIResource {
  protected readonly _client: Transport;

  constructor(client: Transport) {
    this._client = client;
  }
}
