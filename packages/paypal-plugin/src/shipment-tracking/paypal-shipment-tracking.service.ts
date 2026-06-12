import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import {
    EventBus,
    Fulfillment,
    FulfillmentStateTransitionEvent,
    Logger,
    TransactionalConnection,
} from '@vendure/core';
import { Subscription } from 'rxjs';

import { PayPalHttpClient } from '../http-client/paypal-http.client';
import { PayPalTrackingResponse } from '../types';

const loggerCtx = 'PayPalShipmentTrackingService';

/**
 * Listens for fulfillment state transitions to 'Shipped' and pushes the
 * tracking number to the PayPal capture via POST /v2/checkout/orders/{id}/track.
 *
 * Only fires for orders that have a settled PayPal payment with a
 * paypalCaptureId in metadata — non-PayPal orders are silently skipped.
 */
@Injectable()
export class PayPalShipmentTrackingService implements OnApplicationBootstrap, OnModuleDestroy {
    private subscription: Subscription | null = null;

    constructor(
        private readonly eventBus: EventBus,
        private readonly connection: TransactionalConnection,
        private readonly httpClient: PayPalHttpClient,
    ) {}

    onApplicationBootstrap(): void {
        this.subscription = this.eventBus
            .ofType(FulfillmentStateTransitionEvent)
            .subscribe(event => {
                // FulfillmentState is extensible; cast to string for the comparison
                // so the plugin compiles regardless of the host app's state config.
                if ((event.toState as string) === 'Shipped') {
                    this.pushTrackingInfo(event).catch((err: unknown) => {
                        Logger.error(
                            `Failed to push shipment tracking to PayPal: ${err instanceof Error ? err.message : String(err)}`,
                            loggerCtx,
                        );
                    });
                }
            });
    }

    onModuleDestroy(): void {
        this.subscription?.unsubscribe();
        this.subscription = null;
    }

    private async pushTrackingInfo(event: FulfillmentStateTransitionEvent): Promise<void> {
        const { fulfillment, ctx } = event;

        if (!fulfillment.trackingCode) {
            Logger.warn(
                `Fulfillment ${fulfillment.id} transitioned to Shipped but has no trackingCode — skipping PayPal push`,
                loggerCtx,
            );
            return;
        }

        // The fulfillment object on the event may not have relations loaded.
        // Re-fetch with orders and their payments.
        const hydrated = await this.connection
            .getRepository(ctx, Fulfillment)
            .findOne({
                where: { id: fulfillment.id },
                relations: ['orders', 'orders.payments'],
            });

        if (!hydrated) {
            Logger.warn(
                `Could not find Fulfillment ${fulfillment.id} in database — skipping tracking push`,
                loggerCtx,
            );
            return;
        }

        for (const order of hydrated.orders ?? []) {
            const settledPayment = order.payments?.find(p => p.state === 'Settled');
            if (!settledPayment) {
                continue;
            }

            const metadata = settledPayment.metadata as Record<string, unknown> | null;
            const paypalOrderId = metadata?.paypalOrderId as string | undefined;
            const captureId = metadata?.paypalCaptureId as string | undefined;

            if (!paypalOrderId || !captureId) {
                // Not a PayPal-captured order — skip silently.
                continue;
            }

            const carrier = resolveCarrier(fulfillment.method);

            const result = await this.httpClient.post<PayPalTrackingResponse>(
                `/v2/checkout/orders/${paypalOrderId}/track`,
                {
                    capture_id: captureId,
                    tracking_number: fulfillment.trackingCode,
                    carrier,
                    notify_payer: false,
                },
                `track-${captureId}-${fulfillment.id}`,
            );

            Logger.info(
                `PayPal tracking pushed: trackingId=${result.id}, captureId=${captureId}, trackingNumber=${fulfillment.trackingCode}, carrier=${carrier}, orderCode=${order.code}`,
                loggerCtx,
            );
        }
    }
}

/**
 * Maps a Vendure fulfillment method name to a PayPal carrier code.
 * Falls back to 'OTHER' for unrecognised carriers.
 */
function resolveCarrier(method: string): string {
    const m = method.toLowerCase();
    if (m.includes('fedex')) return 'FEDEX';
    if (m.includes('ups')) return 'UPS';
    if (m.includes('usps') || m.includes('postal')) return 'USPS';
    if (m.includes('dhl')) return 'DHL';
    if (m.includes('amazon')) return 'AMAZON';
    if (m.includes('ontrac')) return 'ONTRAC';
    return 'OTHER';
}
