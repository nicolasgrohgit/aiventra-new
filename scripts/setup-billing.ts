/**
 * Automates everything in docs/play-beta-setup.md that has an API, so the only steps left for a
 * human are the ones Google/RevenueCat only expose in their consoles (listed by `status`).
 * Idempotent — every step looks before it creates, so re-running after a partial failure or a
 * later console step is safe.
 *
 *   npm run setup-billing status       # what's done locally, what the next human step is
 *   npm run setup-billing gcp          # service account + key, IAM roles, webhook secret → Cloud Run
 *   npm run setup-billing play         # Play subscription `premium` (monthly + annual), activated
 *   npm run setup-billing revenuecat   # app, credentials, products, entitlement, offering,
 *                                      # packages, webhook, SDK key → eas.json
 *   npm run setup-billing all          # gcp → play → revenuecat, stopping at the first blocker
 *
 * Add `--dry-run` to print every command/request without touching anything (no network, no
 * gcloud). `--skip-cloud-run` leaves the Cloud Run service alone in the gcp phase.
 *
 * Inputs it can't create itself, both read from the gitignored secrets/ directory:
 *   secrets/revenuecat-api-key          a RevenueCat **v2 secret** key (sk_…), project
 *                                       configuration read/write — or RC_API_KEY in the env
 *   secrets/play-service-account.json   written by the gcp phase; must then be invited in Play
 *                                       Console → Users and permissions before `play` works
 *
 * API shapes: https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions
 * and https://www.revenuecat.com/docs/api-v2.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JWT } from 'google-auth-library';

const ROOT = path.resolve(__dirname, '..');
const SECRETS_DIR = path.join(ROOT, 'secrets');
const PLAY_KEY_PATH = path.join(SECRETS_DIR, 'play-service-account.json');
const WEBHOOK_SECRET_PATH = path.join(SECRETS_DIR, 'revenuecat-webhook-secret');
const RC_KEY_PATH = path.join(SECRETS_DIR, 'revenuecat-api-key');
const EAS_JSON_PATH = path.join(ROOT, 'eas.json');

const PACKAGE_NAME: string = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8')).expo.android.package;

const GCP_REGION = process.env.GCP_REGION || 'us-central1';
const CLOUD_RUN_SERVICE = process.env.CLOUD_RUN_SERVICE || 'odysai-server';
const SERVICE_ACCOUNT_NAME = 'odys-play-billing';
const WEBHOOK_SECRET_NAME = 'REVENUECAT_WEBHOOK_SECRET';

// Must match lib/revenuecat-events.ts (PREMIUM_ENTITLEMENT_ID) and the prices in
// components/subscription/plan-comparison.tsx / docs/monetization-strategy.md.
const SUBSCRIPTION_ID = 'premium';
const BASE_PLANS = [
  { id: 'monthly', period: 'P1M', usd: { units: '2', nanos: 990_000_000 }, rcPackage: '$rc_monthly', label: 'Monthly' },
  { id: 'annual', period: 'P1Y', usd: { units: '19', nanos: 990_000_000 }, rcPackage: '$rc_annual', label: 'Annual' },
] as const;

const args = process.argv.slice(2);
const phase = args.find((a) => !a.startsWith('--')) || 'status';
const DRY_RUN = args.includes('--dry-run');
const SKIP_CLOUD_RUN = args.includes('--skip-cloud-run');

class Blocked extends Error {}

// A refused `gcloud … keys create` leaves a 0-byte file behind, so existence alone isn't enough.
function hasPlayKey(): boolean {
  return fs.existsSync(PLAY_KEY_PATH) && fs.statSync(PLAY_KEY_PATH).size > 0;
}

function log(msg: string) {
  console.log(msg);
}
function step(msg: string) {
  console.log(`\n▸ ${msg}`);
}

// ---------------------------------------------------------------------------------------------
// gcloud
// ---------------------------------------------------------------------------------------------

function gcloudBin(): string {
  const local = path.join(os.homedir(), 'google-cloud-sdk', 'bin', 'gcloud');
  // Not on PATH in non-interactive shells on this machine (same story as the Android toolchain).
  return fs.existsSync(local) ? local : 'gcloud';
}

function gcloud(argv: string[], opts: { mutating?: boolean; allowFail?: boolean } = {}): string | null {
  if (DRY_RUN) {
    log(`  [dry-run] gcloud ${argv.join(' ')}`);
    return opts.mutating ? '' : null;
  }
  try {
    return execFileSync(gcloudBin(), argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err: any) {
    if (opts.allowFail) return null;
    throw new Error(`gcloud ${argv.slice(0, 4).join(' ')} … failed:\n${err.stderr || err.message}`);
  }
}

function gcpProject(): string {
  if (process.env.GCP_PROJECT) return process.env.GCP_PROJECT;
  if (DRY_RUN) return '<gcp-project>';
  const project = gcloud(['config', 'get-value', 'project']);
  if (!project || project === '(unset)') throw new Blocked('No gcloud project set. Run `gcloud config set project <id>` or pass GCP_PROJECT.');
  return project;
}

function ensureSecretsDir() {
  if (DRY_RUN) return;
  fs.mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });
}

async function phaseGcp() {
  const project = gcpProject();
  const saEmail = `${SERVICE_ACCOUNT_NAME}@${project}.iam.gserviceaccount.com`;
  ensureSecretsDir();

  step(`Enable APIs on ${project}`);
  gcloud(['services', 'enable', 'androidpublisher.googleapis.com', 'pubsub.googleapis.com', 'secretmanager.googleapis.com', '--project', project], { mutating: true });

  step(`Service account ${saEmail}`);
  const exists = gcloud(['iam', 'service-accounts', 'describe', saEmail, '--project', project], { allowFail: true });
  if (exists === null) {
    gcloud(['iam', 'service-accounts', 'create', SERVICE_ACCOUNT_NAME, '--display-name', 'Odys Play billing (RevenueCat + eas submit)', '--project', project], { mutating: true });
  } else {
    log('  already exists');
  }
  // What RevenueCat asks for so it can set up and monitor Play real-time developer
  // notifications (https://www.revenuecat.com/docs/creating-play-service-credentials).
  for (const role of ['roles/pubsub.editor', 'roles/monitoring.viewer']) {
    gcloud(['projects', 'add-iam-policy-binding', project, '--member', `serviceAccount:${saEmail}`, '--role', role, '--condition', 'None', '--quiet'], { mutating: true });
  }

  let keyBlocked = false;
  step('Service account key → secrets/play-service-account.json');
  if (!DRY_RUN && !hasPlayKey()) fs.rmSync(PLAY_KEY_PATH, { force: true });
  if (!DRY_RUN && hasPlayKey()) {
    log('  already present, not creating another key');
  } else {
    try {
      gcloud(['iam', 'service-accounts', 'keys', 'create', PLAY_KEY_PATH, '--iam-account', saEmail, '--project', project], { mutating: true });
      if (!DRY_RUN) fs.chmodSync(PLAY_KEY_PATH, 0o600);
    } catch (err: any) {
      // Organizations created since 2024 enforce this by default. Lifting it is a security
      // decision for the org owner, so report it and carry on with the steps that don't need
      // the key rather than trying to override the policy from here.
      if (!DRY_RUN) fs.rmSync(PLAY_KEY_PATH, { force: true });
      if (!/iam\.disableServiceAccountKeyCreation/.test(err.message)) throw err;
      keyBlocked = true;
      log('  ! blocked by the org policy iam.disableServiceAccountKeyCreation — continuing without the key');
    }
  }

  step(`Webhook shared secret → Secret Manager (${WEBHOOK_SECRET_NAME})`);
  let createdLocalSecret = false;
  if (DRY_RUN) {
    log('  [dry-run] generate 32 random bytes → secrets/revenuecat-webhook-secret (if missing)');
  } else if (!fs.existsSync(WEBHOOK_SECRET_PATH)) {
    fs.writeFileSync(WEBHOOK_SECRET_PATH, randomBytes(32).toString('hex'), { mode: 0o600 });
    createdLocalSecret = true;
  }
  const secretExists = gcloud(['secrets', 'describe', WEBHOOK_SECRET_NAME, '--project', project], { allowFail: true });
  if (secretExists === null) {
    gcloud(['secrets', 'create', WEBHOOK_SECRET_NAME, '--data-file', WEBHOOK_SECRET_PATH, '--replication-policy', 'automatic', '--project', project], { mutating: true });
  } else if (createdLocalSecret) {
    // The local file is what the revenuecat phase sends to RevenueCat, so the two must match.
    gcloud(['secrets', 'versions', 'add', WEBHOOK_SECRET_NAME, '--data-file', WEBHOOK_SECRET_PATH, '--project', project], { mutating: true });
  } else {
    log('  already exists');
  }

  if (SKIP_CLOUD_RUN) {
    log('\n(skipping Cloud Run — --skip-cloud-run)');
  } else {
    step(`Expose the secret to Cloud Run service ${CLOUD_RUN_SERVICE} (creates a new revision, same image)`);
    let runtimeSa = gcloud(['run', 'services', 'describe', CLOUD_RUN_SERVICE, '--region', GCP_REGION, '--project', project, '--format', 'value(spec.template.spec.serviceAccountName)']);
    if (!runtimeSa) {
      const number = gcloud(['projects', 'describe', project, '--format', 'value(projectNumber)']);
      runtimeSa = `${number || '<project-number>'}-compute@developer.gserviceaccount.com`;
    }
    gcloud(['secrets', 'add-iam-policy-binding', WEBHOOK_SECRET_NAME, '--member', `serviceAccount:${runtimeSa}`, '--role', 'roles/secretmanager.secretAccessor', '--project', project, '--quiet'], { mutating: true });
    gcloud(['run', 'services', 'update', CLOUD_RUN_SERVICE, '--region', GCP_REGION, '--project', project, '--update-secrets', `${WEBHOOK_SECRET_NAME}=${WEBHOOK_SECRET_NAME}:latest`, '--quiet'], { mutating: true });
  }

  if (keyBlocked) {
    throw new Blocked(
      `The rest of the gcp phase ran, but no key could be created for ${saEmail}:\n` +
        '  the organization enforces constraints/iam.disableServiceAccountKeyCreation. RevenueCat and\n' +
        '  `eas submit` both need a JSON key, so an org admin has to exempt this project: Cloud Console →\n' +
        '  IAM & Admin → Organization policies → "Disable service account key creation" → Manage policy →\n' +
        `  Override parent's policy → Enforcement off (project ${project}). That needs the Organization\n` +
        '  Policy Administrator role on the organization. Then re-run: npm run setup-billing gcp'
    );
  }
  log(`\n✓ gcp done. HUMAN STEP: Play Console → Users and permissions → Invite new users →\n  ${saEmail}\n  App permissions for ${PACKAGE_NAME}: View app information, View financial data, Manage orders\n  and subscriptions, Release apps to testing tracks. Then: npm run setup-billing play`);
}

// ---------------------------------------------------------------------------------------------
// Google Play Developer API
// ---------------------------------------------------------------------------------------------

const PLAY_API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}`;

async function playFetch(token: string, method: string, url: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

function playError(what: string, r: { status: number; json: any }): Error {
  const message = r.json?.error?.message || JSON.stringify(r.json);
  if (r.status === 401 || r.status === 403) {
    return new Blocked(
      `${what}: Play refused the service account (${r.status}: ${message}).\n` +
        '  Invite it in Play Console → Users and permissions (see the end of the gcp phase). A new\n' +
        '  invite can take a while to propagate — retry later if you just did it.'
    );
  }
  if (r.status === 404 && /package/i.test(message)) {
    return new Blocked(`${what}: Play doesn't know ${PACKAGE_NAME} yet — upload the first AAB to Internal testing first.`);
  }
  return new Error(`${what} failed (${r.status}): ${message}`);
}

function subscriptionBody(basePlans: unknown[]) {
  return {
    packageName: PACKAGE_NAME,
    productId: SUBSCRIPTION_ID,
    listings: [
      {
        languageCode: 'en-US',
        title: 'Odys.ai Premium',
        benefits: ['Unlimited scheduled trips', 'Unlimited joint-matching invites', 'Proactive event alerts'],
        description: 'Unlimited trips and invites, proactive alerts, and a wider recommendation radius.',
      },
    ],
    basePlans,
  };
}

function basePlanBody(plan: (typeof BASE_PLANS)[number], converted: any) {
  return {
    basePlanId: plan.id,
    autoRenewingBasePlanType: {
      billingPeriodDuration: plan.period,
      // Grace period keeps Premium while Play retries a failed renewal (BILLING_ISSUE →
      // grace_period in lib/revenuecat-events.ts); account hold follows it.
      gracePeriodDuration: 'P7D',
      accountHoldDuration: 'P30D',
      resubscribeState: 'RESUBSCRIBE_STATE_ACTIVE',
    },
    regionalConfigs: Object.values<any>(converted.convertedRegionPrices || {}).map((r) => ({
      regionCode: r.regionCode,
      newSubscriberAvailability: true,
      price: r.price,
    })),
    otherRegionsConfig: {
      usdPrice: converted.convertedOtherRegionsPrice.usdPrice,
      eurPrice: converted.convertedOtherRegionsPrice.eurPrice,
      newSubscriberAvailability: true,
    },
  };
}

async function phasePlay() {
  if (DRY_RUN) {
    step(`Play subscription ${SUBSCRIPTION_ID} for ${PACKAGE_NAME}`);
    for (const plan of BASE_PLANS) {
      log(`  [dry-run] POST ${PLAY_API}/pricing:convertRegionPrices  {price: USD ${plan.usd.units}.${plan.usd.nanos / 10_000_000}}`);
    }
    log(`  [dry-run] POST ${PLAY_API}/subscriptions?productId=${SUBSCRIPTION_ID}&regionsVersion.version=<from convert>`);
    log(`  ${JSON.stringify(subscriptionBody(BASE_PLANS.map((p) => ({ basePlanId: p.id, billingPeriodDuration: p.period, prices: '<converted per region>' }))))}`);
    for (const plan of BASE_PLANS) log(`  [dry-run] POST ${PLAY_API}/subscriptions/${SUBSCRIPTION_ID}/basePlans/${plan.id}:activate`);
    return;
  }
  if (!hasPlayKey()) throw new Blocked('secrets/play-service-account.json is missing — run the gcp phase first.');

  const key = JSON.parse(fs.readFileSync(PLAY_KEY_PATH, 'utf8'));
  const jwt = new JWT({ email: key.client_email, key: key.private_key, scopes: ['https://www.googleapis.com/auth/androidpublisher'] });
  const token = (await jwt.getAccessToken()).token;
  if (!token) throw new Error('Could not get an access token for the Play service account.');

  step(`Play subscription ${SUBSCRIPTION_ID} for ${PACKAGE_NAME}`);
  let existing = await playFetch(token, 'GET', `${PLAY_API}/subscriptions/${SUBSCRIPTION_ID}`);
  if (existing.status !== 200 && existing.status !== 404) throw playError('Reading the subscription', existing);
  // A 404 here is either "no such subscription" (fine, create it) or "no such app".
  if (existing.status === 404 && /package/i.test(existing.json?.error?.message || '')) throw playError('Reading the subscription', existing);

  if (existing.status === 404) {
    const basePlans: unknown[] = [];
    let regionsVersion: string | undefined;
    for (const plan of BASE_PLANS) {
      const conv = await playFetch(token, 'POST', `${PLAY_API}/pricing:convertRegionPrices`, { price: { currencyCode: 'USD', ...plan.usd } });
      if (conv.status !== 200) throw playError(`Converting the ${plan.id} price`, conv);
      regionsVersion = conv.json.regionVersion?.version;
      basePlans.push(basePlanBody(plan, conv.json));
    }
    const url = `${PLAY_API}/subscriptions?productId=${SUBSCRIPTION_ID}&regionsVersion.version=${encodeURIComponent(regionsVersion || '')}`;
    const created = await playFetch(token, 'POST', url, subscriptionBody(basePlans));
    if (created.status !== 200) throw playError('Creating the subscription', created);
    log('  created');
    existing = created;
  } else {
    log('  already exists');
  }

  for (const plan of BASE_PLANS) {
    const current = (existing.json.basePlans || []).find((b: any) => b.basePlanId === plan.id);
    if (!current) {
      log(`  ! base plan ${plan.id} is missing from the existing subscription — add it in Play Console (not patched automatically).`);
      continue;
    }
    if (current.state === 'ACTIVE') {
      log(`  base plan ${plan.id}: active`);
      continue;
    }
    const activated = await playFetch(token, 'POST', `${PLAY_API}/subscriptions/${SUBSCRIPTION_ID}/basePlans/${plan.id}:activate`, {});
    if (activated.status !== 200) throw playError(`Activating base plan ${plan.id}`, activated);
    log(`  base plan ${plan.id}: activated`);
  }
  log('\n✓ play done.');
}

// ---------------------------------------------------------------------------------------------
// RevenueCat API v2
// ---------------------------------------------------------------------------------------------

const RC_API = 'https://api.revenuecat.com/v2';

function rcKey(): string {
  const key = process.env.RC_API_KEY || (fs.existsSync(RC_KEY_PATH) ? fs.readFileSync(RC_KEY_PATH, 'utf8').trim() : '');
  if (!key) {
    throw new Blocked(
      'No RevenueCat API key. HUMAN STEP: RevenueCat → Project settings → API keys → New secret key\n' +
        '  (API version v2, Project configuration: read & write) → save it as secrets/revenuecat-api-key'
    );
  }
  return key;
}

async function rc(method: 'GET' | 'POST', pathname: string, body?: unknown): Promise<any> {
  if (DRY_RUN) {
    if (method !== 'GET') log(`  [dry-run] ${method} ${RC_API}${pathname} ${body ? JSON.stringify(redact(body)) : ''}`);
    return { items: [], id: '<id>' };
  }
  const res = await fetch(`${RC_API}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${rcKey()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`RevenueCat ${method} ${pathname} failed (${res.status}): ${json?.message || text}`);
  return json;
}

// Never echo credentials in dry-run output.
function redact(body: any): any {
  const copy = JSON.parse(JSON.stringify(body));
  if (copy.authorization_header) copy.authorization_header = '<redacted>';
  if (copy.play_store?.play_service_account_credentials_json) copy.play_store.play_service_account_credentials_json = '<redacted>';
  return copy;
}

async function rcList(pathname: string): Promise<any[]> {
  const sep = pathname.includes('?') ? '&' : '?';
  return (await rc('GET', `${pathname}${sep}limit=100`)).items || [];
}

function webhookUrl(): string {
  const eas = JSON.parse(fs.readFileSync(EAS_JSON_PATH, 'utf8'));
  const api = process.env.ODYS_API_URL || eas.build?.preview?.env?.EXPO_PUBLIC_API_URL;
  if (!api) throw new Blocked('No API URL — set ODYS_API_URL or build.preview.env.EXPO_PUBLIC_API_URL in eas.json.');
  return `${String(api).replace(/\/$/, '')}/api/webhooks/revenuecat`;
}

async function phaseRevenueCat() {
  if (!DRY_RUN) rcKey();

  step('Project');
  let projectId = process.env.RC_PROJECT_ID;
  if (!projectId) {
    const projects = await rcList('/projects');
    if (DRY_RUN) projectId = '<project>';
    else if (projects.length === 1) projectId = projects[0].id;
    else throw new Blocked(`This key sees ${projects.length} projects (${projects.map((p) => `${p.id} "${p.name}"`).join(', ')}) — pass RC_PROJECT_ID.`);
  }
  log(`  ${projectId}`);
  const P = `/projects/${projectId}`;

  step(`Play Store app (${PACKAGE_NAME})`);
  let app = (await rcList(`${P}/apps`)).find((a) => a.type === 'play_store' && a.play_store?.package_name === PACKAGE_NAME);
  if (!app) app = await rc('POST', `${P}/apps`, { name: 'Odys.ai (Play Store)', type: 'play_store', play_store: { package_name: PACKAGE_NAME } });
  else log('  already exists');

  step('Play service-account credentials');
  if (!DRY_RUN && app.play_store?.play_service_account_credentials_configured) {
    log('  already configured');
  } else if (DRY_RUN || hasPlayKey()) {
    const credentials = DRY_RUN ? '<key json>' : fs.readFileSync(PLAY_KEY_PATH, 'utf8');
    await rc('POST', `${P}/apps/${app.id}`, { play_store: { package_name: PACKAGE_NAME, play_service_account_credentials_json: credentials } });
    log('  uploaded (RevenueCat validates them against Play in the background — can take up to 36h)');
  } else {
    log('  ! secrets/play-service-account.json missing — run the gcp phase, then re-run this one.');
  }

  step('Products');
  const products = await rcList(`${P}/products`);
  const productIds: Record<string, string> = {};
  for (const plan of BASE_PLANS) {
    const storeId = `${SUBSCRIPTION_ID}:${plan.id}`;
    let product = products.find((p) => p.store_identifier === storeId && p.app_id === app.id);
    if (!product) product = await rc('POST', `${P}/products`, { store_identifier: storeId, app_id: app.id, type: 'subscription', display_name: `Premium ${plan.label}` });
    productIds[plan.id] = product.id;
    log(`  ${storeId} → ${product.id}`);
  }

  step(`Entitlement ${SUBSCRIPTION_ID}`);
  let entitlement = (await rcList(`${P}/entitlements`)).find((e) => e.lookup_key === SUBSCRIPTION_ID);
  if (!entitlement) entitlement = await rc('POST', `${P}/entitlements`, { lookup_key: SUBSCRIPTION_ID, display_name: 'Premium' });
  const attached = new Set((await rcList(`${P}/entitlements/${entitlement.id}/products`)).map((p) => p.id));
  const toAttach = Object.values(productIds).filter((id) => !attached.has(id));
  if (toAttach.length) await rc('POST', `${P}/entitlements/${entitlement.id}/actions/attach_products`, { product_ids: toAttach });
  log(`  ${entitlement.id} (${toAttach.length} product(s) newly attached)`);

  step('Offering default + packages');
  let offering = (await rcList(`${P}/offerings`)).find((o) => o.lookup_key === 'default');
  if (!offering) offering = await rc('POST', `${P}/offerings`, { lookup_key: 'default', display_name: 'Default' });
  // lib/purchases.ts reads offerings.current, so `default` has to be the current one.
  if (!offering.is_current) await rc('POST', `${P}/offerings/${offering.id}`, { is_current: true });
  const packages = await rcList(`${P}/offerings/${offering.id}/packages`);
  for (const [index, plan] of BASE_PLANS.entries()) {
    let pkg = packages.find((p) => p.lookup_key === plan.rcPackage);
    if (!pkg) pkg = await rc('POST', `${P}/offerings/${offering.id}/packages`, { lookup_key: plan.rcPackage, display_name: plan.label, position: index + 1 });
    const pkgProducts = new Set((await rcList(`${P}/packages/${pkg.id}/products`)).map((p) => p.product?.id ?? p.id));
    if (!pkgProducts.has(productIds[plan.id])) {
      await rc('POST', `${P}/packages/${pkg.id}/actions/attach_products`, { products: [{ product_id: productIds[plan.id], eligibility_criteria: 'all' }] });
    }
    log(`  ${plan.rcPackage} → ${productIds[plan.id]}`);
  }

  step('Webhook → Odys server');
  const url = webhookUrl();
  const existingHook = (await rcList(`${P}/integrations/webhooks`)).find((w) => w.url === url);
  if (existingHook) {
    log('  already exists');
  } else if (!DRY_RUN && !fs.existsSync(WEBHOOK_SECRET_PATH)) {
    log('  ! secrets/revenuecat-webhook-secret missing — run the gcp phase, then re-run this one.');
  } else {
    const secret = DRY_RUN ? '<secret>' : fs.readFileSync(WEBHOOK_SECRET_PATH, 'utf8').trim();
    // No `environment` → both sandbox (license testers) and production events are delivered.
    await rc('POST', `${P}/integrations/webhooks`, { name: 'Odys server', url, authorization_header: `Bearer ${secret}` });
    log(`  created → ${url}`);
  }

  step('Public SDK key → eas.json');
  const keys = await rcList(`${P}/apps/${app.id}/public_api_keys`);
  const sdkKey = (keys.find((k) => k.environment === 'production') || keys[0])?.key;
  if (DRY_RUN) {
    log('  [dry-run] write build.preview.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY (production extends preview)');
  } else if (!sdkKey) {
    log('  ! no public API key returned for the app — copy it from RevenueCat → API keys by hand.');
  } else {
    const eas = JSON.parse(fs.readFileSync(EAS_JSON_PATH, 'utf8'));
    if (eas.build.preview.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY === sdkKey) {
      log('  already set');
    } else {
      eas.build.preview.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = sdkKey;
      fs.writeFileSync(EAS_JSON_PATH, `${JSON.stringify(eas, null, 2)}\n`);
      log('  written (public key — safe to commit; takes effect in the next build)');
    }
  }

  log('\n✓ revenuecat done. HUMAN STEP (2 clicks): RevenueCat → the Play app → "Connect to Google"\n  for real-time notifications, then paste the topic it shows into Play Console → Monetize →\n  Monetization setup → Real-time developer notifications.');
}

// ---------------------------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------------------------

function phaseStatus() {
  const eas = JSON.parse(fs.readFileSync(EAS_JSON_PATH, 'utf8'));
  const has = (p: string) => fs.existsSync(p);
  const mark = (ok: boolean) => (ok ? '✓' : '·');
  log(`Package: ${PACKAGE_NAME}\n`);
  log(`${mark(hasPlayKey())} secrets/play-service-account.json        (gcp phase)`);
  log(`${mark(has(WEBHOOK_SECRET_PATH))} secrets/revenuecat-webhook-secret        (gcp phase)`);
  log(`${mark(has(RC_KEY_PATH) || !!process.env.RC_API_KEY)} secrets/revenuecat-api-key               (you: RevenueCat v2 secret key)`);
  log(`${mark(!!eas.build?.preview?.env?.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY)} eas.json EXPO_PUBLIC_REVENUECAT_ANDROID_KEY  (revenuecat phase)`);
  log(`
Console-only steps (no API — see docs/play-beta-setup.md):
  1. First AAB uploaded to Internal testing + Play App Signing accepted   (before \`play\`)
  2. Service account invited in Play Console → Users and permissions      (before \`play\`)
  3. Play App Signing SHA-1 → new Android OAuth client                    (Google Sign-In)
  4. RevenueCat "Connect to Google" → paste topic into Play Console       (after \`revenuecat\`)
  5. License testers + closed-testing tester list`);
}

async function main() {
  if (DRY_RUN) log('DRY RUN — nothing is executed or sent.\n');
  const phases: Record<string, () => Promise<void> | void> = {
    status: phaseStatus,
    gcp: phaseGcp,
    play: phasePlay,
    revenuecat: phaseRevenueCat,
    // revenuecat before play: it only needs the key from gcp, while play also waits on two
    // console-only steps — so a blocked phase doesn't hold back the ones that can still run.
    all: async () => {
      await phaseGcp();
      const blocked: string[] = [];
      for (const [name, fn] of [['revenuecat', phaseRevenueCat], ['play', phasePlay]] as const) {
        try {
          await fn();
        } catch (err) {
          if (!(err instanceof Blocked)) throw err;
          blocked.push(`${name}: ${err.message}`);
        }
      }
      if (blocked.length) throw new Blocked(`\n  ${blocked.join('\n  ')}`);
    },
  };
  const run = phases[phase];
  if (!run) {
    console.error(`Unknown phase "${phase}". Use: status | gcp | play | revenuecat | all  [--dry-run] [--skip-cloud-run]`);
    process.exit(2);
  }
  try {
    await run();
  } catch (err: any) {
    if (err instanceof Blocked) {
      console.error(`\n■ Blocked: ${err.message}`);
      process.exit(3);
    }
    console.error(`\n✗ ${err.message}`);
    process.exit(1);
  }
}

main();
