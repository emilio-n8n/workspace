import { useEffect, useState } from "react";

/**
 * Retarde la propagation d'une valeur de `delayMs` millisecondes — utile pour
 * les recherches et filtres qui ne doivent pas requêter à chaque frappe.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
