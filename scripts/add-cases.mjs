#!/usr/bin/env node
// Merges a Voice Test Lab export into the parser fixture table, so every misheard
// phrase becomes a test. Then fix aliases/parser until `npm test` passes again.
// Usage: npm run add-cases -- <export.json>
// The export is an array of { expected, heard, alternatives, parsed, engine }
// (or an object with that array under "failures").
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { formatFixtures, mergeCases } from '../src/voice/cases.ts';

const FIXTURES = fileURLToPath(new URL('../tests/fixtures/voice-cases.json', import.meta.url));

function fail(message) {
  console.error(`add-cases: ${message}`);
  process.exit(1);
}

const file = process.argv[2];
if (!file) fail('usage: npm run add-cases -- <export.json>');

let exported;
try {
  exported = JSON.parse(readFileSync(file, 'utf8'));
} catch (error) {
  fail(`cannot read ${file}: ${error.message}`);
}
const entries = Array.isArray(exported) ? exported : exported?.failures;
if (!Array.isArray(entries)) fail('expected an array of failures, or { "failures": [...] }');

const fixtures = JSON.parse(readFileSync(FIXTURES, 'utf8'));
const result = mergeCases(fixtures, entries);

for (const { index, reason } of result.invalid) console.error(`  skipped entry ${index}: ${reason}`);
for (const c of result.conflicts)
  console.error(`  conflict "${c.text}": fixtures say ${c.existing}, export says ${c.exported} (left as is)`);

if (result.added > 0) writeFileSync(FIXTURES, formatFixtures(result.fixtures));
console.log(
  `add-cases: ${result.added} added, ${result.skipped} already present, ` +
    `${result.conflicts.length} conflicts, ${result.invalid.length} invalid.`,
);
if (result.added > 0) console.log('Now run npm test and fix aliases/parser until it passes.');
if (result.invalid.length > 0 || result.conflicts.length > 0) process.exit(2);
