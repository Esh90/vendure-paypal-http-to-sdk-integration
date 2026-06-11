import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext } from '@vendure/core';

import {
    CreatePlanInput,
    CreateSubscriptionInput,
    PayPalSubscriptionService,
} from './paypal-subscription.service';

@Resolver()
export class PayPalSubscriptionResolver {
    constructor(private readonly subscriptionService: PayPalSubscriptionService) {}

    @Allow(Permission.SuperAdmin)
    @Query()
    payPalBillingPlans(@Ctx() ctx: RequestContext) {
        return this.subscriptionService.findAllPlans(ctx);
    }

    @Allow(Permission.SuperAdmin)
    @Query()
    payPalSubscriptions(@Ctx() ctx: RequestContext) {
        return this.subscriptionService.findAllSubscriptions(ctx);
    }

    @Allow(Permission.SuperAdmin)
    @Query()
    payPalSubscription(@Ctx() ctx: RequestContext, @Args('id') id: string) {
        return this.subscriptionService.getSubscription(ctx, id);
    }

    @Allow(Permission.SuperAdmin)
    @Mutation()
    createPayPalBillingPlan(
        @Ctx() ctx: RequestContext,
        @Args('input') input: CreatePlanInput,
    ) {
        return this.subscriptionService.createPlan(ctx, input);
    }

    @Allow(Permission.SuperAdmin)
    @Mutation()
    activatePayPalBillingPlan(@Ctx() ctx: RequestContext, @Args('id') id: string) {
        return this.subscriptionService.activatePlan(ctx, id);
    }

    @Allow(Permission.SuperAdmin)
    @Mutation()
    deactivatePayPalBillingPlan(@Ctx() ctx: RequestContext, @Args('id') id: string) {
        return this.subscriptionService.deactivatePlan(ctx, id);
    }

    @Allow(Permission.SuperAdmin)
    @Mutation()
    createPayPalSubscription(
        @Ctx() ctx: RequestContext,
        @Args('input') input: CreateSubscriptionInput,
    ) {
        return this.subscriptionService.createSubscription(ctx, input);
    }

    @Allow(Permission.SuperAdmin)
    @Mutation()
    cancelPayPalSubscription(
        @Ctx() ctx: RequestContext,
        @Args('id') id: string,
        @Args('reason', { nullable: true }) reason?: string,
    ) {
        return this.subscriptionService.cancelSubscription(ctx, id, reason);
    }

    @Allow(Permission.SuperAdmin)
    @Mutation()
    retryPayPalSubscriptionPayment(@Ctx() ctx: RequestContext, @Args('id') id: string) {
        return this.subscriptionService.retrySubscriptionPayment(ctx, id);
    }
}
