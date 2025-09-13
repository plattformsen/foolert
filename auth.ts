import { lookup } from "@deaf/fcrdns";

const trustedHostnames = new Set([
  "jmsn.foo.",
  "localhost.",
]);

/**
 * Normalizes a hostname by ensuring it ends with a trailing
 * dot.
 *
 * @param hostname The hostname to normalize
 * @returns The normalized hostname
 */
function normalizeHostname(hostname: string): string {
  if (!hostname[hostname.length - 1].endsWith(".")) {
    return hostname + ".";
  }
  return hostname;
}

/**
 * Returns the hostname without the first subdomain.
 *
 * The way this method works is that it removes everything
 * leading up to and including the first dot. If there are
 * no dots left, it returns a single dot.
 *
 * @param hostname The hostname to strip the first subdomain from
 * @returns The hostname without the first subdomain.
 */
function baseHostname(hostname: string): string {
  const indexOfFirstDot = hostname.indexOf(".");

  if (indexOfFirstDot === -1) {
    // In this case, we have reached the top-level domain,
    // empty string, or a TLD (like "localhost") that hasn't
    // been normalized.
    return ".";
  }

  return hostname.slice(indexOfFirstDot + 1);
}

export async function authenticateRequest(
  ip: string,
): Promise<undefined | AuthenticationContext> {
  console.debug("debug: Authenticating request from IP: %s", ip);

  const { resolvedHostnames, hostnames } = await lookup(ip);
  console.debug("debug: All hostnames: %o", hostnames);
  console.debug("debug: Resolved hostnames: %o", resolvedHostnames);

  const trusted = new Set<string>();

  for (const hostname of resolvedHostnames) {
    let host: string | undefined = normalizeHostname(hostname);
    let dot = false;

    while (host !== undefined) {
      if (host === ".") {
        dot = true;
      }

      if (trustedHostnames.has(host)) {
        trusted.add(hostname);
        break;
      }

      if (dot) {
        // We have already seen a dot, so we can stop here.
        break;
      }

      host = baseHostname(host);
    }
  }

  if (trusted.size === 0) {
    return undefined;
  }

  return {
    ip,
    hostnames: Array.from(trusted),
  };
}

export interface AuthenticationContext {
  ip: string;
  hostnames: string[];
}
