// Structured JSON logging for the API routes. One line per significant
// outcome, machine-parseable in Vercel's log drain / dashboard. Underscore
// prefix keeps this file from being exposed as an endpoint.
//
// Never log secrets, tokens, file contents, or message bodies — ids and
// outcomes only.

export function apiLog(route: string, outcome: string, fields: Record<string, unknown> = {}): void {
  try {
    console.log(JSON.stringify({ src: "roamly-api", route, outcome, time: new Date().toISOString(), ...fields }));
  } catch {
    console.log(`roamly-api ${route} ${outcome}`);
  }
}
