// Shared demo-account definitions — no side effects on import (unlike seed-demo-accounts.ts,
// which runs its seed routine and exits at module scope). Both seed-demo-accounts.ts and
// demo-account-linker.ts import from here instead of from each other, so requiring the email
// list doesn't accidentally re-run the seed and kill the importing process.

export interface DemoAccountDef {
  email: string;
  firstName: string;
  lastName: string;
  homebase: string;
}

export const DEMO_ACCOUNTS: DemoAccountDef[] = [
  { email: 'sarah.connor@odysai.demo', firstName: 'Sarah', lastName: 'Connor', homebase: 'Paris, France' },
  { email: 'ron.burgundy@odysai.demo', firstName: 'Ron', lastName: 'Burgundy', homebase: 'Palo Alto, USA' },
  { email: 'bridget.jones@odysai.demo', firstName: 'Bridget', lastName: 'Jones', homebase: 'London, UK' },
];

export const DEMO_ACCOUNT_EMAILS = DEMO_ACCOUNTS.map(a => a.email);
