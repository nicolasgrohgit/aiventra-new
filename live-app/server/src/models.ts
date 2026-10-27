import mongoose, { Schema, Types } from 'mongoose';

const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    displayName: { type: String, required: true, trim: true, maxlength: 30 },
    dob: { type: Date, required: true },
    coins: { type: Number, default: 0, min: 0 },
    diamonds: { type: Number, default: 0, min: 0 },
    blocked: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    banned: { type: Boolean, default: false },
    deletedAt: Date,
  },
  { timestamps: true },
);

const StreamSchema = new Schema(
  {
    host: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, maxlength: 80 },
    status: { type: String, enum: ['live', 'ended'], default: 'live', index: true },
    viewers: { type: Number, default: 0 },
    diamondsEarned: { type: Number, default: 0 },
    endedAt: Date,
  },
  { timestamps: true },
);

// Every balance change is recorded; `ref` is unique when set so store
// webhooks replayed by RevenueCat can never credit a purchase twice.
const LedgerSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ['purchase', 'gift_sent', 'gift_received', 'payout', 'adjust'], required: true },
    coins: { type: Number, default: 0 },
    diamonds: { type: Number, default: 0 },
    ref: { type: String, unique: true, sparse: true },
    meta: Schema.Types.Mixed,
  },
  { timestamps: true },
);

const ReportSchema = new Schema(
  {
    reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    target: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    stream: { type: Schema.Types.ObjectId, ref: 'Stream' },
    reason: { type: String, required: true, maxlength: 500 },
    status: { type: String, enum: ['open', 'actioned', 'dismissed'], default: 'open', index: true },
  },
  { timestamps: true },
);

const PayoutSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    diamonds: { type: Number, required: true },
    amountUsd: { type: Number, required: true },
    // Where to send it: the streamer's Wise email or IBAN/account details.
    destination: { type: String, required: true, maxlength: 300 },
    status: { type: String, enum: ['pending', 'paid', 'rejected'], default: 'pending', index: true },
    paidAt: Date,
    note: String,
  },
  { timestamps: true },
);

export const User = mongoose.model('User', UserSchema);
export const Stream = mongoose.model('Stream', StreamSchema);
export const Ledger = mongoose.model('Ledger', LedgerSchema);
export const Report = mongoose.model('Report', ReportSchema);
export const Payout = mongoose.model('Payout', PayoutSchema);

export const isObjectId = (id: unknown): id is string => typeof id === 'string' && Types.ObjectId.isValid(id);
