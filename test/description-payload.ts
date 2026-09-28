export const descriptionPayload = [
  "Fast, simple. It's here. Quotes: \"hello\"; path: /tmp/pkg; URL: https://x.org; ~tilde~; slash: \\.",
  'Plain description with <script>alert(1)</script>, [a link](https://example.com), $x, and Japanese 日本語.',
  '<javascript://%0Aalert(1)> and \\<javascript://%0Aalert(1)> and [x](javascript:alert(1))',
  '</p><img src=x onerror="alert(1)"> &lt;script&gt; &#96; &amp; ``` ~~~',
  '```@eval', 'write("description-executed", "unsafe")', 'nothing', '```',
  '~~~@eval', 'write("description-executed", "unsafe")', '~~~',
  '```@raw html', '<script>alert(1)</script>', '```',
  '    ```@eval', '    write("description-executed", "unsafe")', '    ```',
].join('\n');
