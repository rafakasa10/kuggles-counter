#!/usr/bin/env node
// Fails if any word of our Vosk grammar is missing from the model's vocabulary.
// Vosk silently ignores grammar words it doesn't know, which would make that word
// unrecognisable, so CI runs this against the real model.
// Usage: node scripts/check-vosk-vocab.mjs <unpacked-model-dir>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildVoskGrammar } from '../src/voice/grammar.ts';

const FST_MAGIC = 2125659606;
const SYMTAB_MAGIC = 2125658996;

function readString(buf, offset) {
  const len = buf.readInt32LE(offset);
  return [buf.toString('utf8', offset + 4, offset + 4 + len), offset + 4 + len];
}

function readSymbolTable(buf, offset) {
  if (buf.readInt32LE(offset) !== SYMTAB_MAGIC) throw new Error('Unexpected symbol table header');
  let o = offset + 4;
  [, o] = readString(buf, o); // table name
  o += 8; // available key
  const size = Number(buf.readBigInt64LE(o));
  o += 8;
  const words = new Set();
  for (let i = 0; i < size; i++) {
    let word;
    [word, o] = readString(buf, o);
    o += 8; // key
    words.add(word);
  }
  return [words, o];
}

/** Reads the output symbol table embedded in an OpenFst binary (graph/Gr.fst). */
export function readFstWords(path) {
  const buf = readFileSync(path);
  if (buf.readInt32LE(0) !== FST_MAGIC) throw new Error(`${path} is not an OpenFst binary`);
  let o = 4;
  [, o] = readString(buf, o); // fst type
  [, o] = readString(buf, o); // arc type
  o += 4; // version
  const flags = buf.readInt32LE(o);
  o += 4 + 8 + 8 + 8 + 8; // flags, properties, start, numstates, numarcs
  let words = null;
  if (flags & 1) [words, o] = readSymbolTable(buf, o); // input symbols
  if (flags & 2) [words, o] = readSymbolTable(buf, o); // output symbols
  if (!words) throw new Error(`${path} has no embedded symbol table`);
  return words;
}

const modelDir = process.argv[2];
if (!modelDir) {
  console.error('Usage: node scripts/check-vosk-vocab.mjs <unpacked-model-dir>');
  process.exit(2);
}
const aliases = JSON.parse(readFileSync(new URL('../src/voice/aliases/en.json', import.meta.url), 'utf8'));
const vocab = readFstWords(join(modelDir, 'graph', 'Gr.fst'));
const grammar = buildVoskGrammar(aliases, { includeUnk: false });
const missing = grammar.filter((w) => !vocab.has(w));
if (missing.length > 0) {
  console.error(`Grammar words missing from the model vocabulary (${vocab.size} words): ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`Vocabulary check passed: all ${grammar.length} grammar words are in the model (${vocab.size} words).`);
