/** Literal text for GitHub's CommonMark renderer. */
export function markdownText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/[!-/:-@\[-`{-~]/g, '\\$&');
}

/** Documenter uses Julia Markdown, whose escaping differs from CommonMark.
 * A fixed raw-HTML block holds only escaped text, never user markup or links.
 * Encode fence characters and keep its content on one line so input cannot
 * close the block and introduce a Documenter directive. */
export function documenterText(value: string): string {
  if (!value) return '';
  const entities: Record<string, string> = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '`': '&#96;', '~': '&#126;'};
  const text = value.replace(/\r\n?/g, '\n').replace(/[&<>`~]/g, char => entities[char]).replaceAll('\n', '<br>');
  return '```@raw html\n<p class="pkgfactory-description">' + text + '</p>\n```';
}
