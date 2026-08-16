/**
 * Lazy loader for the generated wire data.
 *
 * `public/wire.json` is produced at build/dev start by `scripts/gen-wire.ts`
 * from `contract/SCENARIOS.md` and the five per-language contract runners, so it
 * cannot drift from the contract suite. It is fetched on demand — the landing
 * bundle never imports it.
 */

export interface WireScenario {
  num: number;
  call: string;
  pins: string;
  samples: Record<string, string>;
}

export interface WireSection {
  title: string;
  body: string;
}

export interface WireData {
  totalRequests: number;
  scenarios: WireScenario[];
  sections: WireSection[];
}

let cache: WireData | null = null;
let inflight: Promise<WireData> | null = null;

export async function loadWire(): Promise<WireData> {
  if (cache) return cache;
  if (!inflight) {
    inflight = fetch('/wire.json')
      .then(async (r) => {
        if (!r.ok) throw new Error(`wire.json: ${r.status}`);
        const data = (await r.json()) as WireData;
        cache = data;
        return data;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}