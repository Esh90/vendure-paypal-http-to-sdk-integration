import { Injectable } from '@nestjs/common';
import { Logger, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';

import { PayPalApiError } from '../http-client/paypal-http.client';

import { PayPalHttpClient } from '../http-client/paypal-http.client';
import {
    PayPalCreatePlanRequest,
    PayPalCreateSubscriptionRequest,
    PayPalIntervalUnit,
    PayPalPlanResponse,
    PayPalSubscriptionResponse,
} from '../types';
import { PayPalBillingPlan } from './entities/paypal-billing-plan.entity';
import { PayPalSubscription } from './entities/paypal-subscription.entity';

const loggerCtx = 'PayPalSubscriptionService';

export interface CreatePlanInput {
    productId: string;
    name: string;
    description?: string | null;
    intervalUnit: string;
    intervalCount: number;
    price: string;
    currencyCode: string;
}

export interface CreateSubscriptionInput {
    planId: string;
    customerId?: string | null;
    returnUrl: string;
    cancelUrl: string;
    startTime?: string | null;
}

@Injectable()
export class PayPalSubscriptionService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly httpClient: PayPalHttpClient,
    ) {}

    /**
     * Creates a PayPal billing plan and persists it locally.
     *
     * Requires an existing PayPal Product ID — create the product first via the
     * PayPal dashboard (Sandbox → Catalogue → Products) or the Products API.
     */
    async createPlan(ctx: RequestContext, input: CreatePlanInput): Promise<PayPalBillingPlan> {
        const planRequest: PayPalCreatePlanRequest = {
            product_id: input.productId,
            name: input.name,
            description: input.description ?? undefined,
            billing_cycles: [
                {
                    frequency: {
                        interval_unit: input.intervalUnit as PayPalIntervalUnit,
                        interval_count: input.intervalCount,
                    },
                    tenure_type: 'REGULAR',
                    sequence: 1,
                    total_cycles: 0,
                    pricing_scheme: {
                        fixed_price: {
                            value: input.price,
                            currency_code: input.currencyCode,
                        },
                    },
                },
            ],
            payment_preferences: {
                auto_bill_outstanding: true,
                setup_fee_failure_action: 'CONTINUE',
                payment_failure_threshold: 3,
            },
        };

        const paypalPlan = await this.httpClient.post<PayPalPlanResponse>('/v1/billing/plans', planRequest);

        const plan = new PayPalBillingPlan();
        plan.paypalPlanId = paypalPlan.id;
        plan.name = input.name;
        plan.description = input.description ?? null;
        plan.status = paypalPlan.status;
        plan.paypalProductId = input.productId;
        plan.intervalUnit = input.intervalUnit;
        plan.intervalCount = input.intervalCount;
        plan.price = input.price;
        plan.currencyCode = input.currencyCode;

        const saved = await this.connection.getRepository(ctx, PayPalBillingPlan).save(plan);
        Logger.info(`PayPal billing plan created: planId=${paypalPlan.id}, name=${input.name}`, loggerCtx);
        return saved;
    }

    async activatePlan(ctx: RequestContext, id: string): Promise<PayPalBillingPlan> {
        const plan = await this.connection
            .getRepository(ctx, PayPalBillingPlan)
            .findOne({ where: { id: Number(id) } });
        if (!plan) {
            throw new UserInputError(`PayPal billing plan with id ${id} not found`);
        }

        // PayPal creates plans as ACTIVE by default in sandbox. If it is already
        // active locally there is nothing to do.
        if (plan.status === 'ACTIVE') {
            Logger.info(`PayPal billing plan already active: planId=${plan.paypalPlanId}`, loggerCtx);
            return plan;
        }

        try {
            await this.httpClient.post<void>(`/v1/billing/plans/${plan.paypalPlanId}/activate`, {});
        } catch (err: unknown) {
            // PLAN_STATUS_INVALID means PayPal already considers the plan active.
            // Sync the local status and return rather than throwing.
            if (
                err instanceof PayPalApiError &&
                typeof err.errorBody === 'object' &&
                err.errorBody.details?.some(d => d.issue === 'PLAN_STATUS_INVALID')
            ) {
                Logger.info(
                    `PayPal plan already in non-activatable state — syncing to ACTIVE: planId=${plan.paypalPlanId}`,
                    loggerCtx,
                );
                plan.status = 'ACTIVE';
                return this.connection.getRepository(ctx, PayPalBillingPlan).save(plan);
            }
            throw err;
        }

        plan.status = 'ACTIVE';
        const updated = await this.connection.getRepository(ctx, PayPalBillingPlan).save(plan);
        Logger.info(`PayPal billing plan activated: planId=${plan.paypalPlanId}`, loggerCtx);
        return updated;
    }

    async deactivatePlan(ctx: RequestContext, id: string): Promise<PayPalBillingPlan> {
        const plan = await this.connection
            .getRepository(ctx, PayPalBillingPlan)
            .findOne({ where: { id: Number(id) } });
        if (!plan) {
            throw new UserInputError(`PayPal billing plan with id ${id} not found`);
        }

        await this.httpClient.post<void>(`/v1/billing/plans/${plan.paypalPlanId}/deactivate`, {});
        plan.status = 'INACTIVE';
        const updated = await this.connection.getRepository(ctx, PayPalBillingPlan).save(plan);
        Logger.info(`PayPal billing plan deactivated: planId=${plan.paypalPlanId}`, loggerCtx);
        return updated;
    }

    /**
     * Creates a PayPal subscription under an ACTIVE plan.
     *
     * Returns the subscription record including the `approvalUrl` that the subscriber
     * must visit to authorise recurring charges. After approval, PayPal redirects to
     * the provided `returnUrl`. The subscription status updates to ACTIVE once the
     * webhook confirms activation (or on the next `payPalSubscription` query).
     */
    async createSubscription(
        ctx: RequestContext,
        input: CreateSubscriptionInput,
    ): Promise<PayPalSubscription> {
        const plan = await this.connection
            .getRepository(ctx, PayPalBillingPlan)
            .findOne({ where: { id: Number(input.planId) } });
        if (!plan) {
            throw new UserInputError(`PayPal billing plan with id ${input.planId} not found`);
        }
        if (plan.status !== 'ACTIVE') {
            throw new UserInputError(
                `PayPal billing plan ${input.planId} is not active (current status: ${plan.status})`,
            );
        }

        const subscriptionRequest: PayPalCreateSubscriptionRequest = {
            plan_id: plan.paypalPlanId,
            start_time: input.startTime ?? undefined,
            application_context: {
                return_url: input.returnUrl,
                cancel_url: input.cancelUrl,
                user_action: 'SUBSCRIBE_NOW',
            },
        };

        const paypalSub = await this.httpClient.post<PayPalSubscriptionResponse>(
            '/v1/billing/subscriptions',
            subscriptionRequest,
        );

        const approvalLink = paypalSub.links?.find(l => l.rel === 'approve');

        const subscription = new PayPalSubscription();
        subscription.paypalSubscriptionId = paypalSub.id;
        subscription.paypalPlanId = plan.paypalPlanId;
        subscription.vendureCustomerId = input.customerId ?? null;
        subscription.status = paypalSub.status;
        subscription.approvalUrl = approvalLink?.href ?? null;
        subscription.startTime = input.startTime ?? null;

        const saved = await this.connection.getRepository(ctx, PayPalSubscription).save(subscription);
        Logger.info(
            `PayPal subscription created: subscriptionId=${paypalSub.id}, planId=${plan.paypalPlanId}`,
            loggerCtx,
        );
        return saved;
    }

    /**
     * Fetches the current subscription status from PayPal and syncs it locally.
     * Returns null if the subscription record does not exist locally.
     */
    async getSubscription(ctx: RequestContext, id: string): Promise<PayPalSubscription | null> {
        const subscription = await this.connection
            .getRepository(ctx, PayPalSubscription)
            .findOne({ where: { id: Number(id) } });
        if (!subscription) {
            return null;
        }

        try {
            const paypalSub = await this.httpClient.get<PayPalSubscriptionResponse>(
                `/v1/billing/subscriptions/${subscription.paypalSubscriptionId}`,
            );
            if (subscription.status !== paypalSub.status) {
                subscription.status = paypalSub.status;
                return this.connection.getRepository(ctx, PayPalSubscription).save(subscription);
            }
        } catch (err: unknown) {
            Logger.warn(
                `Failed to sync subscription status from PayPal for ${subscription.paypalSubscriptionId}: ${err instanceof Error ? err.message : String(err)}`,
                loggerCtx,
            );
        }
        return subscription;
    }

    async cancelSubscription(
        ctx: RequestContext,
        id: string,
        reason?: string | null,
    ): Promise<PayPalSubscription> {
        const subscription = await this.connection
            .getRepository(ctx, PayPalSubscription)
            .findOne({ where: { id: Number(id) } });
        if (!subscription) {
            throw new UserInputError(`PayPal subscription with id ${id} not found`);
        }

        await this.httpClient.post<void>(
            `/v1/billing/subscriptions/${subscription.paypalSubscriptionId}/cancel`,
            { reason: reason ?? 'Cancelled by merchant' },
        );
        subscription.status = 'CANCELLED';
        const updated = await this.connection.getRepository(ctx, PayPalSubscription).save(subscription);
        Logger.info(
            `PayPal subscription cancelled: subscriptionId=${subscription.paypalSubscriptionId}`,
            loggerCtx,
        );
        return updated;
    }

    /**
     * Retries capturing the outstanding balance on a subscription that has a failed payment.
     * Returns true on success, false if the capture call fails.
     */
    async retrySubscriptionPayment(ctx: RequestContext, id: string): Promise<boolean> {
        const subscription = await this.connection
            .getRepository(ctx, PayPalSubscription)
            .findOne({ where: { id: Number(id) } });
        if (!subscription) {
            throw new UserInputError(`PayPal subscription with id ${id} not found`);
        }

        try {
            await this.httpClient.post<void>(
                `/v1/billing/subscriptions/${subscription.paypalSubscriptionId}/capture`,
                {
                    note: 'Manual capture of outstanding balance by merchant',
                    capture_type: 'OUTSTANDING_BALANCE',
                },
            );
            Logger.info(
                `PayPal subscription payment retried: subscriptionId=${subscription.paypalSubscriptionId}`,
                loggerCtx,
            );
            return true;
        } catch (err: unknown) {
            Logger.error(
                `Failed to retry payment for subscription ${subscription.paypalSubscriptionId}: ${err instanceof Error ? err.message : String(err)}`,
                loggerCtx,
            );
            return false;
        }
    }

    async findAllPlans(ctx: RequestContext): Promise<{ items: PayPalBillingPlan[]; totalItems: number }> {
        const [items, totalItems] = await this.connection
            .getRepository(ctx, PayPalBillingPlan)
            .findAndCount();
        return { items, totalItems };
    }

    async findAllSubscriptions(
        ctx: RequestContext,
    ): Promise<{ items: PayPalSubscription[]; totalItems: number }> {
        const [items, totalItems] = await this.connection
            .getRepository(ctx, PayPalSubscription)
            .findAndCount();
        return { items, totalItems };
    }
}
