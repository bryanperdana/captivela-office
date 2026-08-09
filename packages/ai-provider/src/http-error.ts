/**
 * Detail text for a non-OK HTTP response body. Real API errors (JSON/plain
 * text) are surfaced as-is, truncated. HTML bodies — an edge/WAF block page or
 * a login page served instead of an API response (e.g. hosted service's SPA shell on
 * a 403) — are replaced with a short readable note, since dumping raw markup
 * into the chat UI is useless to the user.
 */
export function httpBodyDetail(body: string): string {
  const head = body.trimStart().slice(0, 30).toLowerCase()
  const isHtml = ['<!doctype', '<html', '<head', '<body'].some((tag) => head.startsWith(tag))
  if (isHtml) {
    return 'the service returned a web page instead of an API response (likely a temporary network or gateway block) — check your connection and retry'
  }
  return body.slice(0, 500)
}
