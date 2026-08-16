import { useEffect, useState } from 'react';
import { loadReference, type Reference } from '../data/reference';

/** Loads the reference payload once (cached in the data module), exposes state. */
export function useReference(): { ref: Reference | null; error: Error | null } {
  const [ref, setRef] = useState<Reference | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let alive = true;
    loadReference()
      .then((r) => {
        if (alive) setRef(r);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e : new Error(String(e)));
      });
    return () => {
      alive = false;
    };
  }, []);
  return { ref, error };
}