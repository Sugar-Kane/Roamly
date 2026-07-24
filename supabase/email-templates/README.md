# Roamly Flow auth email templates

Branded replacements for Supabase's default auth emails (warm Coffee Shop
palette, orange header with the dot + 3/4-circle logo, table layout, inline
styles — safe in Gmail/Outlook/Apple Mail).

The logo is a single hosted image, `https://roamlyflow.com/logo-email.png`
(served from `public/`). Keep that hosted URL — Gmail and Outlook block base64
data-URI images, so an inlined logo would break in real inboxes.

## How to install (per template, ~30s each)

Supabase Dashboard → **Authentication → Emails** → pick the template → set the
Subject → replace the Body with the file's HTML → Save.

| File | Supabase template | Suggested subject |
| --- | --- | --- |
| `confirm-signup.html` | Confirm signup | Confirm your Roamly Flow account ✔️ |
| `invite.html` | Invite user | You're invited to Roamly Flow 📚 |
| `magic-link.html` | Magic Link or OTP | Your Roamly Flow sign-in link 🔑 |
| `change-email-address.html` | Change email address | Confirm your new Roamly Flow email 📧 |
| `reset-password.html` | Reset password | Reset your Roamly Flow password 🔒 |
| `reauthentication.html` | Reauthentication | Your Roamly Flow verification code 🔐 |

`{{ .ConfirmationURL }}` and `{{ .Email }}` are Supabase template variables —
leave them as-is when pasting. Two templates use extra variables:
`change-email-address.html` uses `{{ .NewEmail }}`, and `reauthentication.html`
uses `{{ .Token }}` (a one-time code the user types back into the app — this
template has no button/link by design).

## Sender name

Templates control the body only. The "Supabase Auth <noreply@mail.app.supabase.io>"
sender can only be changed by enabling **custom SMTP** (Authentication → SMTP
settings; Resend is an easy option) — which also lifts the built-in ~2-4
emails/hour rate limit.
