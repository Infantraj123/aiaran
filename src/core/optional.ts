import { DependencyMissingError } from "./errors.js";

const cache = new Map<string, Promise<unknown>>();

/**
 * Import an optional peer dependency, throwing DependencyMissingError with
 * installation instructions when it is not installed.
 */
export function optionalImport<T>(specifier: string, feature: string): Promise<T> {
  let pending = cache.get(specifier);
  if (!pending) {
    pending = import(specifier).then(
      (mod: unknown) => {
        const m = mod as { default?: unknown };
        // CommonJS packages expose their API on `default` when imported from ESM.
        return (m.default && typeof m.default === "object" ? { ...m.default, ...m } : m) as unknown;
      },
      () => {
        cache.delete(specifier);
        const pkg = specifier.startsWith("@")
          ? specifier.split("/").slice(0, 2).join("/")
          : (specifier.split("/")[0] ?? specifier);
        throw new DependencyMissingError(pkg, feature);
      },
    );
    cache.set(specifier, pending);
  }
  return pending as Promise<T>;
}
