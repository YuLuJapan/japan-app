// One-off: generate the VAPID key pair that signs web push messages.
//   npm run push:keys
// Paste the output into .env.local and into the Vercel project's env vars.
// Regenerating the keys invalidates every existing device subscription, so do
// it once and keep them.
import webpush from 'web-push'

const { publicKey, privateKey } = webpush.generateVAPIDKeys()

console.log(`
VAPID keys generated. Add these to .env.local and to Vercel → Settings →
Environment Variables (Production + Preview). Keep the private key secret.

VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
VAPID_SUBJECT=mailto:you@example.com
`)
