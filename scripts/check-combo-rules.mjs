// usage: node scripts/check-combo-rules.mjs
import { build } from 'esbuild';

const out = await build({
  entryPoints: ['scripts/check-combo-rules.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const code = out.outputFiles[0].text;
await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
