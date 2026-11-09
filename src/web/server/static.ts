import assets from '../assets.json' with {type: 'json'};
import { unbase64 } from '../../core/encoding.js';
// The files embedded by scripts/assets.ts, served verbatim by every host.
const files: Record<string, [BodyInit, string]> = {
  '/app.js': [assets.js, 'text/javascript'], '/style.css': [assets.css, 'text/css'],
  '/assets/logo.svg': [assets.logo, 'image/svg+xml'], '/assets/github.svg': [assets.github, 'image/svg+xml'],
  '/assets/hero.png': [unbase64(assets.hero), 'image/png'], '/assets/ogp.png': [unbase64(assets.ogp), 'image/png'],
};
export function staticFile(request: Request): Response | null {
  const file = request.method === 'GET' ? files[new URL(request.url).pathname] : undefined;
  return file ? new Response(file[0], {headers: {'Content-Type': file[1]}}) : null;
}
