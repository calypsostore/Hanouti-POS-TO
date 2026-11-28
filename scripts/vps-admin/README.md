# Hanouti POS VPS administrative interface

The v2 helper and its existing workflows remain separate from v3. V3 provides
signed backup manifests and local-only restore handoff, signed Edge Function
releases, versioned Supabase stack deployment with backup-gated activation,
manual rollback procedures, and a narrow bootstrap/revocation process.

V3 is **not installed or staged on the VPS**. No root authorization or
deployment has been requested or performed. Follow the complete procedure,
security limits, commands, and validation status in
[`README-v3.md`](./README-v3.md).
