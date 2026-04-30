export function publicApiBaseUrl(requestUrl?: string): string {
  const configured =
    process.env.OPENCAIRN_PUBLIC_API_URL ??
    process.env.PUBLIC_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    process.env.API_PUBLIC_URL;
  if (configured) return configured.replace(/\/+$/, "");
  if (requestUrl) {
    const url = new URL(requestUrl);
    return `${url.protocol}//${url.host}`;
  }
  return "http://localhost:8787";
}

export function mcpResourceUrl(requestUrl?: string): string {
  return `${publicApiBaseUrl(requestUrl)}/api/mcp`;
}

export function mcpProtectedResourceMetadata(requestUrl?: string) {
  const resource = mcpResourceUrl(requestUrl);
  return {
    resource,
    authorization_servers: [] as string[],
    scopes_supported: ["workspace:read"],
    bearer_methods_supported: ["header"],
    resource_documentation: `${publicApiBaseUrl(requestUrl)}/docs/mcp-server`,
  };
}

export function mcpBearerChallenge(requestUrl?: string): string {
  return `Bearer resource_metadata="${publicApiBaseUrl(requestUrl)}/.well-known/oauth-protected-resource/api/mcp"`;
}
