import { describe, expect, it } from 'vitest';
import { countWords, isChapterLike, joinLines, normalizeText, splitSentences } from '../textUtils';
import { FR_PARAGRAPH } from './fixtures';

const texts = (s: string, lang?: string) => splitSentences(s, lang).map((x) => x.text);

describe('normalizeText', () => {
  it('expands ligatures and removes invisible characters', () => {
    expect(normalizeText('ef\uFB01cient \uFB02ow o\uFB03ce co\uFB00ee')).toBe('efficient flow office coffee');
    expect(normalizeText('soft­hyphen zero​width')).toBe('softhyphen zerowidth');
  });

  it('turns unusual spaces into normal spaces and collapses them', () => {
    expect(normalizeText('a b c d   e\t f')).toBe('a b c d e f');
  });

  it('composes accents (NFD to NFC) without changing the words', () => {
    const decomposed = 'été';
    expect(normalizeText(decomposed)).toBe('été');
    expect(normalizeText(decomposed).length).toBe(3);
  });

  it('keeps line breaks but trims spaces around them', () => {
    expect(normalizeText('one  \n  two')).toBe('one\ntwo');
  });
});

describe('joinLines', () => {
  it('rejoins a word split by an end-of-line hyphen', () => {
    expect(joinLines(['the infor-', 'mation was'])).toBe('the information was');
  });

  it('also rejoins words split with the Unicode hyphen U+2010', () => {
    expect(joinLines(['was fi\u2010', 'nally launched'])).toBe('was finally launched');
  });

  it('keeps the hyphen when the next part starts with a capital', () => {
    expect(joinLines(['the Anglo-', 'Saxon period'])).toBe('the Anglo-Saxon period');
  });

  it('rejoins accented words', () => {
    expect(joinLines(['une évé-', 'nement'])).toBe('une événement');
  });

  it('removes a soft hyphen at the end of a line', () => {
    expect(joinLines(['hyphen­', 'ation'])).toBe('hyphenation');
  });

  it('joins ordinary lines with a space', () => {
    expect(joinLines(['first line', '  second line  ', ''])).toBe('first line second line');
  });
});

describe('splitSentences', () => {
  it('does not split after common abbreviations', () => {
    expect(texts('Dr. Smith met Mr. Jones. They talked.')).toEqual(['Dr. Smith met Mr. Jones.', 'They talked.']);
  });

  it('does not split decimals or initials', () => {
    expect(texts('The value is 3.14 today. J. R. Hartley wrote it.')).toEqual(['The value is 3.14 today.', 'J. R. Hartley wrote it.']);
  });

  it('keeps "e.g." and "i.e." inside the sentence', () => {
    expect(texts('Use a tool, e.g. a hammer. Then stop.')).toEqual(['Use a tool, e.g. a hammer.', 'Then stop.']);
  });

  it('handles dialogue with quotes', () => {
    const s = '"Are you coming?" she asked. "Not yet," he said. "Wait for me!"';
    expect(texts(s)).toEqual(['"Are you coming?" she asked.', '"Not yet," he said.', '"Wait for me!"']);
  });

  it('handles French text with guillemets, accents and a decimal comma', () => {
    const out = texts(FR_PARAGRAPH, 'fr');
    expect(out).toEqual([
      "L'été dernier, Hélène a traversé la forêt à pied.",
      '« Où vas-tu ? » lui a demandé son frère.',
      "Elle a répondu qu'elle cherchait la source de la rivière, à 12,5 km du village.",
      "M. Lefèvre, l'instituteur, lui avait prêté une carte annotée à la main.",
    ]);
  });

  it('returns offsets that point back into the source text', () => {
    const src = '  First one.   Second one!  ';
    for (const s of splitSentences(src)) expect(src.slice(s.start, s.end)).toBe(s.text);
  });
});

describe('countWords', () => {
  it('counts accented words (an elision like "L\'été" is one word)', () => {
    expect(countWords("L'été à Montréal", 'fr')).toBe(3);
    expect(countWords('one, two; three... 4.5')).toBe(4);
  });
});

describe('isChapterLike', () => {
  it('recognizes chapter headings', () => {
    for (const h of ['Chapter 3', 'CHAPTER IV', 'Chapitre 2 : Le port', 'Part One', 'IV', '12.']) expect(isChapterLike(h)).toBe(true);
  });
  it('rejects normal text', () => {
    for (const h of ['The chapter ends here.', 'Introduction', 'Parts of speech are useful']) expect(isChapterLike(h)).toBe(false);
  });
});
