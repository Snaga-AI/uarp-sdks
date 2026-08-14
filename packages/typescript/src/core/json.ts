/** JSON value aliases shared by generated models and the transport. */

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

/** Anything the SDK accepts where the API expects raw bytes. */
export type BinaryInput = Blob | ArrayBuffer | ArrayBufferView | Uint8Array | string;

/** A file part for multipart uploads. `Blob`/`File` carry their own filename. */
export type FileInput = BinaryInput | { data: BinaryInput; filename?: string; contentType?: string };
