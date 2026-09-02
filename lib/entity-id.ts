// Shared "is this the same record" check for locally-normalized entities that carry both a
// client-side `id` and (once synced) a server `_id` — trips and contacts both do this (see
// hooks/useTrips.tsx, hooks/useContacts.tsx). Previously hand-rolled as
// `a.id === b.id || a._id === b._id` at 6 call sites across those two files. Deliberately
// permissive rather than defensive (matches the original inline checks exactly): if neither
// side has an `id` or `_id`, `undefined === undefined` still reads as a match — every call
// site here only ever compares real array items, never nullish values, so this has never been
// an observable bug in practice.

export interface EntityId {
  id?: string;
  _id?: string;
}

export function sameEntity(a: EntityId, b: EntityId): boolean {
  return a.id === b.id || a._id === b._id;
}
