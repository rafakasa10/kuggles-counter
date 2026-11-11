import en from '../../voice/aliases/en.json';
import { multiplierSynonyms } from './score.ts';

/** treble/trip/triples → triple, doubles/dub → double, … (same meaning, different words). */
export const SYNONYMS = multiplierSynonyms(en.multipliers);
