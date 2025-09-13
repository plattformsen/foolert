import { lookup } from "@deaf/fcrdns";

const trustedHostnames = new Set([
  "jmsn.foo.",
  "localhost.",
]);

function normalizeHostname(hostname: string): string {
  if (!hostname[hostname.length - 1].endsWith(".")) {
    return hostname + ".";
  }
  return hostname;
}

function baseHostname(hostname: string): string | undefined {
  // strip the first subdomain
  const indexOfDot = hostname.indexOf(".");
  if (indexOfDot === -1) {
    return undefined;
  }
  return hostname.slice(indexOfDot + 1);
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

    while (host !== undefined) {
      if (trustedHostnames.has(host)) {
        trusted.add(hostname);
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
