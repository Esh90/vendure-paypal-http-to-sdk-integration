import {
    CancelPaymentErrorResult,
    CancelPaymentResult,
    CreatePaymentErrorResult,
    CreatePaymentResult,
    CreateRefundResult,
    Injector,
    LanguageCode,
    Logger,
    PaymentMethodHandler,
    SettlePaymentErrorResult,
    SettlePaymentResult,
} from '@vendure/core';

import { PayPalApiError, PayPalHttpClient } from '../http-client/paypal-http.client';
import {
    PayPalCaptureDetails,
    PayPalCreateOrderRequest,
    PayPalLink,
    PayPalOrderResponse,
    PayPalRefundResponse,
} from '../types';

const loggerCtx = 'PayPalPaymentHandler';

// Populated via the init() hook once the NestJS DI container is ready.
let client: PayPalHttpClient;

export const paypalPaymentHandler = new PaymentMethodHandler({
    code: 'paypal',
    description: [{ languageCode: LanguageCode.en, value: 'PayPal' }],

    args: {
        intent: {
            type: 'string' as const,
            defaultValue: 'CAPTURE',
            required: true,
            label: [{ languageCode: LanguageCode.en, value: 'Payment Intent' }],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value:
                        'CAPTURE — charge the buyer immediately upon settlement. ' +
                        'AUTHORIZE — reserve funds when settled, then capture them at fulfillment.',
                },
            ],
            ui: {
                component: 'select-form-input',
                options: [{ value: 'CAPTURE' }, { value: 'AUTHORIZE' }],
            },
        },
        returnUrl: {
            type: 'string' as const,
            required: true,
            label: [{ languageCode: LanguageCode.en, value: 'Return URL' }],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'Storefront URL PayPal redirects the buyer to after they approve the payment.',
                },
            ],
        },
        cancelUrl: {
            type: 'string' as const,
            required: true,
            label: [{ languageCode: LanguageCode.en, value: 'Cancel URL' }],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'Storefront URL PayPal redirects the buyer to if they cancel.',
                },
            ],
        },
    },

    init(injector: Injector): void {
        client = injector.get(PayPalHttpClient);
    },

    /**
     * Creates a PayPal order using the configured intent (CAPTURE or AUTHORIZE).
     *
     * Returns state 'Authorized' together with the PayPal order ID and the
     * buyer-approval URL (in metadata.public so the storefront can read it).
     * The storefront directs the buyer to that URL; once approved, settlePayment()
     * performs the capture (CAPTURE intent) or the authorization+capture (AUTHORIZE intent).
     */
    createPayment: async (
        ctx,
        order,
        amount,
        args,
        metadata,
    ): Promise<CreatePaymentResult | CreatePaymentErrorResult> => {
        try {
            // Vendure stores monetary amounts as integers in the minor currency unit
            // (e.g. cents). PayPal expects a decimal string.
            const amountValue = (amount / 100).toFixed(2);
            const currencyCode = order.currencyCode;
            const intent = (args.intent ?? 'CAPTURE') as 'CAPTURE' | 'AUTHORIZE';

            const requestBody: PayPalCreateOrderRequest = {
                intent,
                purchase_units: [
                    {
                        reference_id: order.code,
                        amount: {
                            currency_code: currencyCode,
                            value: amountValue,
                        },
                    },
                ],
                payment_source: {
                    paypal: {
                        experience_context: {
                            return_url: args.returnUrl,
                            cancel_url: args.cancelUrl,
                            // PAY_NOW renders a single "Pay Now" button that both approves
                            // and redirects in one click. Without this, PayPal shows a
                            // "Review Order" button that does nothing visible to the buyer.
                            user_action: 'PAY_NOW',
                        },
                    },
                },
            };

            const paypalOrder = await client.post<PayPalOrderResponse>(
                '/v2/checkout/orders',
                requestBody,
                `create-order-${order.code}`,
            );

            const approvalLink = paypalOrder.links.find(
                (l: PayPalLink) => l.rel === 'payer-action' || l.rel === 'approve',
            );

            if (!approvalLink) {
                Logger.error(
                    `PayPal order ${paypalOrder.id} returned no approval link for Vendure order ${order.code}`,
                    loggerCtx,
                );
                return {
                    amount,
                    state: 'Declined' as const,
                    metadata: {
                        errorMessage: 'PayPal did not return a buyer-approval URL.',
                    },
                };
            }

            Logger.info(
                `PayPal order created: paypalOrderId=${paypalOrder.id}, intent=${intent}, vendureOrderCode=${order.code}`,
                loggerCtx,
            );

            return {
                amount,
                state: 'Authorized' as const,
                transactionId: paypalOrder.id,
                metadata: {
                    paypalOrderId: paypalOrder.id,
                    paypalOrderStatus: paypalOrder.status,
                    paypalIntent: intent,
                    // `public` sub-object is visible in the Shop API so the storefront
                    // can read the approval URL and redirect the buyer.
                    public: {
                        approvalUrl: approvalLink.href,
                    },
                },
            };
        } catch (err: unknown) {
            const message = toErrorMessage(err);
            Logger.error(
                `createPayment failed for Vendure order ${order.code}: ${message}`,
                loggerCtx,
            );
            return {
                amount,
                state: 'Declined' as const,
                metadata: { errorMessage: message },
            };
        }
    },

    /**
     * Settles a buyer-approved PayPal order.
     *
     * CAPTURE intent: calls POST /v2/checkout/orders/{id}/capture directly.
     *
     * AUTHORIZE intent: first calls POST /v2/checkout/orders/{id}/authorize to
     * reserve the funds, then immediately calls
     * POST /v2/payments/authorizations/{authorizationId}/capture to move the money.
     * The merchant controls when this happens by deciding when to call settlePayment
     * (typically at fulfillment time).
     */
    settlePayment: async (
        ctx,
        order,
        payment,
        args,
    ): Promise<SettlePaymentResult | SettlePaymentErrorResult> => {
        const metadata = payment.metadata as Record<string, unknown>;
        const paypalOrderId =
            (metadata?.paypalOrderId as string | undefined) ?? payment.transactionId;
        const intent = (args.intent ?? 'CAPTURE') as 'CAPTURE' | 'AUTHORIZE';

        if (!paypalOrderId) {
            return {
                success: false,
                errorMessage: 'No PayPal order ID found in payment metadata.',
            };
        }

        try {
            if (intent === 'CAPTURE') {
                return await captureOrder(client, paypalOrderId, String(payment.id), order.code);
            } else {
                return await authorizeAndCapture(client, paypalOrderId, String(payment.id), order.code);
            }
        } catch (err: unknown) {
            const message = toErrorMessage(err);
            Logger.error(
                `settlePayment failed for Vendure order ${order.code}: ${message}`,
                loggerCtx,
            );
            return { success: false, errorMessage: message };
        }
    },

    /**
     * Voids a PayPal authorization, releasing the reserved funds back to the buyer.
     *
     * Applies to AUTHORIZE intent payments where an authorization was created (i.e.
     * settlePayment ran far enough to call /v2/checkout/orders/{id}/authorize) but
     * the order has not yet been fully captured. CAPTURE intent orders in the
     * Authorized state have no PayPal-side resource to void — the order simply lapses.
     *
     * Idempotent: if the authorization is already voided or captured, PayPal returns
     * 422 AUTHORIZATION_ALREADY_VOIDED / AUTHORIZATION_ALREADY_CAPTURED, both of
     * which we treat as success to allow safe retry.
     */
    cancelPayment: async (
        ctx,
        order,
        payment,
        args,
    ): Promise<CancelPaymentResult | CancelPaymentErrorResult> => {
        const metadata = payment.metadata as Record<string, unknown>;
        const authorizationId = metadata?.paypalAuthorizationId as string | undefined;

        if (!authorizationId) {
            // No PayPal authorization exists yet — nothing to void.
            return { success: true };
        }

        const result = await voidAuthorization(client, authorizationId, order.code);
        if (!result.success) {
            return { success: false, errorMessage: result.errorMessage };
        }
        return { success: true };
    },

    /**
     * Issues a full or partial refund against the PayPal capture recorded in payment metadata.
     *
     * Sends POST /v2/payments/captures/{captureId}/refund with the Vendure-computed
     * amount. When the amount equals the full captured amount this is a full refund;
     * when it is less, PayPal processes a partial refund. Multiple partial refunds
     * against the same capture are supported up to the original captured total.
     *
     * The idempotency key includes the amount so that two distinct partial refund
     * amounts are treated as separate operations while identical retries are safe.
     */
    createRefund: async (
        ctx,
        input,
        amount,
        order,
        payment,
    ): Promise<CreateRefundResult> => {
        const metadata = payment.metadata as Record<string, unknown>;
        const captureId = metadata?.paypalCaptureId as string | undefined;

        if (!captureId) {
            Logger.error(
                `createRefund called for Vendure order ${order.code} but no paypalCaptureId found in payment metadata`,
                loggerCtx,
            );
            return {
                state: 'Failed' as const,
                metadata: { errorMessage: 'No PayPal capture ID found in payment metadata.' },
            };
        }

        try {
            // Vendure amounts are in minor currency units (e.g. cents); PayPal expects a decimal string.
            const refundAmount = (amount / 100).toFixed(2);

            const refundResponse = await client.post<PayPalRefundResponse>(
                `/v2/payments/captures/${captureId}/refund`,
                {
                    amount: {
                        value: refundAmount,
                        currency_code: order.currencyCode,
                    },
                },
                // Key includes the amount so two different partial refunds against the
                // same payment are treated as distinct operations, not retries.
                `refund-${String(payment.id)}-${amount}`,
            );

            const state: 'Settled' | 'Pending' | 'Failed' =
                refundResponse.status === 'COMPLETED'
                    ? 'Settled'
                    : refundResponse.status === 'PENDING'
                      ? 'Pending'
                      : 'Failed';

            Logger.info(
                `PayPal refund ${refundResponse.status}: refundId=${refundResponse.id}, amount=${refundAmount} ${order.currencyCode}, captureId=${captureId}, vendureOrderCode=${order.code}`,
                loggerCtx,
            );

            return {
                state,
                transactionId: refundResponse.id,
                metadata: {
                    paypalRefundId: refundResponse.id,
                    refundStatus: refundResponse.status,
                },
            };
        } catch (err: unknown) {
            const message = toErrorMessage(err);
            Logger.error(
                `createRefund failed for Vendure order ${order.code}: ${message}`,
                loggerCtx,
            );
            return {
                state: 'Failed' as const,
                metadata: { errorMessage: message },
            };
        }
    },
});

// ─── Settle helpers ───────────────────────────────────────────────────────────

/**
 * Captures a CAPTURE-intent PayPal order via
 * POST /v2/checkout/orders/{orderId}/capture.
 */
async function captureOrder(
    httpClient: PayPalHttpClient,
    paypalOrderId: string,
    paymentId: string,
    orderCode: string,
): Promise<SettlePaymentResult | SettlePaymentErrorResult> {
    const captureResponse = await httpClient.post<PayPalOrderResponse>(
        `/v2/checkout/orders/${paypalOrderId}/capture`,
        {},
        `capture-${paymentId}`,
    );

    const captureDetails =
        captureResponse.purchase_units?.[0]?.payments?.captures?.[0];

    if (!captureDetails) {
        return {
            success: false,
            errorMessage: 'PayPal capture response did not include capture details.',
        };
    }

    if (captureDetails.status === 'DECLINED') {
        Logger.warn(
            `PayPal capture DECLINED: paypalOrderId=${paypalOrderId}, vendureOrderCode=${orderCode}`,
            loggerCtx,
        );
        return { success: false, errorMessage: 'PayPal capture was declined.' };
    }

    Logger.info(
        `PayPal order captured: captureId=${captureDetails.id}, paypalOrderId=${paypalOrderId}, vendureOrderCode=${orderCode}`,
        loggerCtx,
    );

    return {
        success: true,
        metadata: {
            paypalCaptureId: captureDetails.id,
            captureStatus: captureDetails.status,
            captureAmount: captureDetails.amount,
        },
    };
}

/**
 * Authorizes an AUTHORIZE-intent PayPal order and immediately captures it.
 *
 * Two sequential PayPal calls:
 * 1. POST /v2/checkout/orders/{orderId}/authorize  → reserves the funds
 * 2. POST /v2/payments/authorizations/{id}/capture → moves the money
 *
 * The authorizationId is stored in metadata so cancelPayment() can void it if
 * the capture step fails before the payment state transitions in Vendure.
 */
async function authorizeAndCapture(
    httpClient: PayPalHttpClient,
    paypalOrderId: string,
    paymentId: string,
    orderCode: string,
): Promise<SettlePaymentResult | SettlePaymentErrorResult> {
    // Step 1 — Authorize (reserve funds)
    const authorizeResponse = await httpClient.post<PayPalOrderResponse>(
        `/v2/checkout/orders/${paypalOrderId}/authorize`,
        {},
        `authorize-${paymentId}`,
    );

    const authorizationDetails =
        authorizeResponse.purchase_units?.[0]?.payments?.authorizations?.[0];

    if (!authorizationDetails) {
        return {
            success: false,
            errorMessage: 'PayPal authorize response did not include authorization details.',
        };
    }

    if (authorizationDetails.status === 'DENIED') {
        Logger.warn(
            `PayPal authorization DENIED: paypalOrderId=${paypalOrderId}, vendureOrderCode=${orderCode}`,
            loggerCtx,
        );
        return { success: false, errorMessage: 'PayPal authorization was denied.' };
    }

    const authorizationId = authorizationDetails.id;
    Logger.info(
        `PayPal order authorized: authorizationId=${authorizationId}, paypalOrderId=${paypalOrderId}, vendureOrderCode=${orderCode}`,
        loggerCtx,
    );

    // Step 2 — Capture (move the money).
    // If this step fails for any reason, immediately void the authorization so the
    // buyer's funds are not left reserved indefinitely.
    let captureDetails: PayPalCaptureDetails;
    try {
        captureDetails = await httpClient.post<PayPalCaptureDetails>(
            `/v2/payments/authorizations/${authorizationId}/capture`,
            {},
            `capture-auth-${paymentId}`,
        );
    } catch (captureErr: unknown) {
        Logger.warn(
            `PayPal capture threw after authorize — auto-voiding: authorizationId=${authorizationId}, vendureOrderCode=${orderCode}`,
            loggerCtx,
        );
        await voidAuthorization(httpClient, authorizationId, orderCode);
        throw captureErr;
    }

    if (!captureDetails || captureDetails.status === 'DECLINED') {
        Logger.warn(
            `PayPal capture DECLINED after authorize — auto-voiding: authorizationId=${authorizationId}, vendureOrderCode=${orderCode}`,
            loggerCtx,
        );
        await voidAuthorization(httpClient, authorizationId, orderCode);
        return {
            success: false,
            errorMessage: 'PayPal capture was declined after authorization.',
        };
    }

    Logger.info(
        `PayPal authorization captured: captureId=${captureDetails.id}, authorizationId=${authorizationId}, vendureOrderCode=${orderCode}`,
        loggerCtx,
    );

    return {
        success: true,
        metadata: {
            paypalAuthorizationId: authorizationId,
            paypalCaptureId: captureDetails.id,
            captureStatus: captureDetails.status,
            captureAmount: captureDetails.amount,
        },
    };
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Voids a PayPal authorization and returns a typed result.
 *
 * Treats 422 AUTHORIZATION_ALREADY_VOIDED and AUTHORIZATION_ALREADY_CAPTURED as
 * success — the funds are no longer reserved either way, so the cancellation goal
 * is achieved regardless.
 */
async function voidAuthorization(
    httpClient: PayPalHttpClient,
    authorizationId: string,
    orderCode: string,
): Promise<{ success: true } | { success: false; errorMessage: string }> {
    try {
        await httpClient.post<void>(
            `/v2/payments/authorizations/${authorizationId}/void`,
            {},
        );
        Logger.info(
            `PayPal authorization voided: authorizationId=${authorizationId}, vendureOrderCode=${orderCode}`,
            loggerCtx,
        );
        return { success: true };
    } catch (err: unknown) {
        if (err instanceof PayPalApiError && isAlreadyFinalised(err)) {
            Logger.info(
                `PayPal authorization already finalised (void is a no-op): authorizationId=${authorizationId}`,
                loggerCtx,
            );
            return { success: true };
        }
        const message = toErrorMessage(err);
        Logger.error(
            `Failed to void authorization ${authorizationId} for Vendure order ${orderCode}: ${message}`,
            loggerCtx,
        );
        return { success: false, errorMessage: message };
    }
}

/**
 * Returns true when PayPal signals the authorization is already in a terminal
 * state — voided or fully captured. Both cases mean the void goal is met.
 */
function isAlreadyFinalised(err: PayPalApiError): boolean {
    if (typeof err.errorBody !== 'object') return false;
    const terminalIssues = new Set([
        'AUTHORIZATION_ALREADY_VOIDED',
        'AUTHORIZATION_ALREADY_CAPTURED',
    ]);
    return (
        err.errorBody.details?.some(d => terminalIssues.has(d.issue)) ?? false
    );
}

function toErrorMessage(err: unknown): string {
    if (err instanceof PayPalApiError) return err.message;
    if (err instanceof Error) return err.message;
    return String(err);
}
