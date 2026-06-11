import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Logger } from '@vendure/core';

import { PAYPAL_BASE_URLS, PAYPAL_PLUGIN_OPTIONS, TOKEN_REFRESH_BUFFER_MS } from '../constants';
import { PayPalApiErrorBody, PayPalPluginOptions, PayPalTokenResponse } from '../types';

const loggerCtx = 'PayPalHttpClient';

// ─── Error class ─────────────────────────────────────────────────────────────

export class PayPalApiError extends Error {
    override readonly name = 'PayPalApiError';

    constructor(
        public readonly statusCode: number,
        public readonly statusText: string,
        public readonly errorBody: PayPalApiErrorBody | string,
    ) {
        let detail: string;
        if (typeof errorBody === 'object') {
            const hasName = errorBody.name != null;
            const hasMessage = errorBody.message != null;
            if (hasName || hasMessage) {
                const detailsStr =
                    Array.isArray(errorBody.details) && errorBody.details.length > 0
                        ? ` | ${errorBody.details.map(d => `${d.issue}: ${d.description}`).join('; ')}`
                        : '';
                detail = `${errorBody.name ?? '(no name)'}: ${errorBody.message ?? '(no message)'}${detailsStr}${errorBody.debug_id ? ` (debug_id: ${errorBody.debug_id})` : ''}`;
            } else {
                detail = JSON.stringify(errorBody);
            }
        } else {
            detail = errorBody || '(empty body)';
        }
        super(`PayPal API ${statusCode} ${statusText} — ${detail}`);
    }
}

// ─── HTTP client ─────────────────────────────────────────────────────────────

@Injectable()
export class PayPalHttpClient implements OnModuleDestroy {
    private accessToken: string | null = null;
    private tokenExpiresAt = 0;
    private refreshTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        @Inject(PAYPAL_PLUGIN_OPTIONS)
        private readonly options: PayPalPluginOptions,
    ) {}

    onModuleDestroy(): void {
        if (this.refreshTimer !== null) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    private get baseUrl(): string {
        return PAYPAL_BASE_URLS[this.options.environment];
    }

    // ── Public request helpers ──────────────────────────────────────────────

    async get<T>(path: string): Promise<T> {
        return this.request<T>('GET', path);
    }

    async post<T>(path: string, body: unknown, idempotencyKey?: string): Promise<T> {
        return this.request<T>('POST', path, body, idempotencyKey);
    }

    async patch<T>(path: string, body: unknown): Promise<T> {
        return this.request<T>('PATCH', path, body);
    }

    async delete<T = void>(path: string): Promise<T> {
        return this.request<T>('DELETE', path);
    }

    // ── Core request dispatcher ─────────────────────────────────────────────

    private async request<T>(
        method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
        path: string,
        body?: unknown,
        idempotencyKey?: string,
    ): Promise<T> {
        const token = await this.ensureValidToken();

        const headers: Record<string, string> = {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        };

        if (idempotencyKey !== undefined) {
            headers['PayPal-Request-Id'] = idempotencyKey;
        }

        const response = await fetch(`${this.baseUrl}${path}`, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });

        if (!response.ok) {
            const rawBody = await response.text();
            let errorBody: PayPalApiErrorBody | string;
            try {
                errorBody = JSON.parse(rawBody) as PayPalApiErrorBody;
            } catch {
                errorBody = rawBody;
            }
            Logger.error(
                `${method} ${path} → ${response.status} ${response.statusText}`,
                loggerCtx,
            );
            throw new PayPalApiError(response.status, response.statusText, errorBody);
        }

        if (response.status === 204) {
            return undefined as unknown as T;
        }

        return response.json() as Promise<T>;
    }

    // ── Token management ────────────────────────────────────────────────────

    private async ensureValidToken(): Promise<string> {
        if (
            this.accessToken !== null &&
            Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS
        ) {
            return this.accessToken;
        }
        return this.fetchNewToken();
    }

    private async fetchNewToken(): Promise<string> {
        const credentials = Buffer.from(
            `${this.options.clientId}:${this.options.clientSecret}`,
        ).toString('base64');

        const response = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${credentials}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: 'grant_type=client_credentials',
        });

        if (!response.ok) {
            const errorText = await response.text();
            Logger.error(
                `Token request failed: ${response.status} ${response.statusText}`,
                loggerCtx,
            );
            throw new Error(
                `PayPal token request failed (${response.status}): ${errorText}`,
            );
        }

        const data = (await response.json()) as PayPalTokenResponse;
        this.accessToken = data.access_token;
        this.tokenExpiresAt = Date.now() + data.expires_in * 1_000;

        this.scheduleProactiveRefresh(data.expires_in);
        Logger.info('PayPal access token refreshed', loggerCtx);
        return this.accessToken;
    }

    /** Schedules a background refresh 60 s before the token expires. */
    private scheduleProactiveRefresh(expiresInSeconds: number): void {
        if (this.refreshTimer !== null) {
            clearTimeout(this.refreshTimer);
        }
        const delayMs = Math.max(0, (expiresInSeconds - 60) * 1_000);
        this.refreshTimer = setTimeout(() => {
            this.fetchNewToken().catch((err: unknown) => {
                Logger.error(
                    `Proactive token refresh failed: ${err instanceof Error ? err.message : String(err)}`,
                    loggerCtx,
                );
            });
        }, delayMs);
    }
}
