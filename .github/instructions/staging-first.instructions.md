---
name: Staging-First Delivery
description: Enforce for builds, releases, deploys, and infrastructure changes.
applyTo: '**'
---

Read `SERVICE_CONTEXT.md`. Deploy and verify staging first. Production requires fresh approval for the exact staged candidate and must not rebuild it. Staging uses production data directly; every staging write is a production write.
