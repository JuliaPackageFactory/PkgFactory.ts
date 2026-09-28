export const descriptionPayload = [
  'Plain description with <script>alert(1)</script>, [a link](https://example.com), $x, and Japanese 日本語.',
  '```@eval', 'write("description-executed", "unsafe")', 'nothing', '```',
  '~~~@eval', 'write("description-executed", "unsafe")', '~~~',
  '```@raw html', '<script>alert(1)</script>', '```',
  '    ```@eval', '    write("description-executed", "unsafe")', '    ```',
].join('\n');
