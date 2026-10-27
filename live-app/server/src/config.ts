import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name} (see .env.example)`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  mongoUri: required('MONGODB_URI'),
  jwtSecret: required('JWT_SECRET'),
  livekitUrl: required('LIVEKIT_URL'), // wss://<project>.livekit.cloud
  livekitApiKey: required('LIVEKIT_API_KEY'),
  livekitApiSecret: required('LIVEKIT_API_SECRET'),
  // Value you set as the "Authorization header" in RevenueCat's webhook settings.
  revenuecatWebhookAuth: required('REVENUECAT_WEBHOOK_AUTH'),
  adminKey: process.env.ADMIN_KEY ?? '',
};
