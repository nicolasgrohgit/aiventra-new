export const MIN_AGE = 18;

/** Parses a strict YYYY-MM-DD date of birth; returns undefined if malformed or impossible. */
export function parseDob(dob: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return undefined;
  return date;
}

export function ageOn(dob: Date, now: Date): number {
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age--;
  return age;
}

export function isAdult(dob: Date, now = new Date()): boolean {
  return ageOn(dob, now) >= MIN_AGE;
}
