// Minimal text filter for stream titles, display names and chat. A real
// launch should add a moderation API (e.g. image/video + text classifiers);
// this blocks the obvious cases the stores check for in review.
const BLOCKED = [
  'nude', 'nudes', 'porn', 'onlyfans', 'sex cam', 'escort', 'cashapp', 'venmo', 'paypal me',
  'telegram', 'whatsapp', 'snapchat', 'under 18', 'underage', 'minor',
];

const normalize = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ');

/** Returns the first blocked term found, or undefined if the text is clean. */
export function findBlockedTerm(text: string): string | undefined {
  const t = ` ${normalize(text)} `;
  return BLOCKED.find((term) => t.includes(` ${term} `));
}
