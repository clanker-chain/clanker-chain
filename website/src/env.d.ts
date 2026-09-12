/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_PRIVY_APP_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
