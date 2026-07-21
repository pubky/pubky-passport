# Shared Libraries

This folder contains small utilities that are shared across features without
becoming feature orchestration. It includes configuration parsing, bounded body
reads, redaction, and the application logger.

Do not put product flows, Google/Drive/Pubky integrations, or Next.js route logic
here. Server configuration stays under `env/server.ts`; browser-capable code may
use only `env/public.ts` and must never import server configuration.
