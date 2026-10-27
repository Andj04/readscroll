// Original texts written for the tests (no copyrighted material).

export const EN_SENTENCES = [
  'The harbour town woke slowly under a pale sky.',
  'Fishermen untied their boats while gulls argued over the nets.',
  'Dr. Moreau, who kept the lighthouse, counted the vessels as they left.',
  'He wrote each name in a ledger that was older than the town hall.',
  'By noon the tide had turned, and the water in the bay was 3.5 metres deep.',
  'Nobody remembered when the ledger had first been opened.',
  'Children ran along the quay, shouting the names of the boats they knew.',
  'Mrs. Alder sold bread from a cart painted the colour of the sea.',
  'At dusk the lamps were lit one by one, from the church to the pier.',
  'The keeper climbed the stairs and wound the great clock by hand.',
];

/** Builds a paragraph of n sentences by cycling through EN_SENTENCES. */
export function paragraph(n: number, offset = 0): string {
  return Array.from({ length: n }, (_, i) => EN_SENTENCES[(i + offset) % EN_SENTENCES.length]).join(' ');
}

export const FR_PARAGRAPH =
  "L'été dernier, Hélène a traversé la forêt à pied. « Où vas-tu ? » lui a demandé son frère. " +
  "Elle a répondu qu'elle cherchait la source de la rivière, à 12,5 km du village. " +
  "M. Lefèvre, l'instituteur, lui avait prêté une carte annotée à la main.";
