export const PAYPAL_PLUGIN_OPTIONS = Symbol('PAYPAL_PLUGIN_OPTIONS');

export const PAYPAL_BASE_URLS = {
    sandbox: 'https://api-m.sandbox.paypal.com',
    production: 'https://api-m.paypal.com',
} as const;

/** Refresh the access token this many ms before it actually expires. */
export const TOKEN_REFRESH_BUFFER_MS = 60_000;
