#!/usr/bin/env node
// Regenerates src/schema.d.ts from the Realtime Sports API OpenAPI spec.
//
//   npm run generate                      # production spec (https://www.realtimesportsapi.com/openapi.json)
//   SPEC=/tmp/rsa-spec/openapi.json npm run generate   # a local file
//
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = process.env.SPEC || 'https://www.realtimesportsapi.com/openapi.json';
const out = path.join(root, 'src', 'schema.d.ts');

console.log(`Generating ${path.relative(root, out)} from ${spec}`);
execFileSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['openapi-typescript', spec, '--output', out],
  { cwd: root, stdio: 'inherit' }
);
