/** Render user text literally; it must never introduce Documenter directives. */
export function markdownText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/[!-/:-@\[-`{-~]/g, '\\$&');
}
