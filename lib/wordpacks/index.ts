import english from './english.json';
import spanish from './spanish.json';
import french from './french.json';
import german from './german.json';
import romanian from './romanian.json';

export interface WordEntry {
  category: string;
  civilian_word: string;
}

export const SUPPORTED_LANGUAGES = ['english', 'spanish', 'french', 'german', 'romanian'] as const;
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

const packs: Record<SupportedLanguage, WordEntry[]> = {
  english: english as WordEntry[],
  spanish: spanish as WordEntry[],
  french: french as WordEntry[],
  german: german as WordEntry[],
  romanian: romanian as WordEntry[],
};

export function getWordPack(language: string): WordEntry[] {
  return packs[language as SupportedLanguage] ?? packs.english;
}

export function getRandomWord(language: string): { word: string; category: string } {
  const pack = getWordPack(language);
  const entry = pack[Math.floor(Math.random() * pack.length)];
  return {
    word: entry.civilian_word,
    category: entry.category,
  };
}
