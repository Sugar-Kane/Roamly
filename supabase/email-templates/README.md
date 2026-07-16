# Roamly Flow auth email templates

Branded replacements for Supabase's default auth emails (warm Coffee Shop
palette, table layout, inline styles — safe in Gmail/Outlook/Apple Mail).

## How to install (per template, ~30s each)

Supabase Dashboard → **Authentication → Emails** → pick the template → set the
Subject → replace the Body with the file's HTML → Save.

| File | Supabase template | Suggested subject |
| --- | --- | --- |
| `invite.html` | Invite user | You're invited to Roamly Flow 📚 |
| `confirm-signup.html` | Confirm signup | Confirm your Roamly Flow account ✔️ |
| `magic-link.html` | Magic Link | Your Roamly Flow sign-in link 🔑 |
| `reset-password.html` | Reset password | Reset your Roamly Flow password 🔒 |

`{{ .ConfirmationURL }}` and `{{ .Email }}` are Supabase template variables —
leave them as-is when pasting.

## Sender name

Templates control the body only. The "Supabase Auth <noreply@mail.app.supabase.io>"
sender can only be changed by enabling **custom SMTP** (Authentication → SMTP
settings; Resend is an easy option) — which also lifts the built-in ~2-4
emails/hour rate limit.
