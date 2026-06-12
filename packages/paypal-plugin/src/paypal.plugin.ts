import { PluginCommonModule, Type, VendurePlugin } from '@vendure/core';

import { adminApiExtensions } from './admin-api-extensions';
import { PAYPAL_PLUGIN_OPTIONS } from './constants';
import { PayPalHttpClient } from './http-client/paypal-http.client';
import { paypalPaymentHandler } from './payment-handler/paypal-payment.handler';
import { paypalPaymentProcess } from './payment-handler/paypal-payment.process';
import { PayPalReportingResolver } from './reporting/paypal-reporting.resolver';
import { PayPalReportingService } from './reporting/paypal-reporting.service';
import { PayPalShipmentTrackingService } from './shipment-tracking/paypal-shipment-tracking.service';
import { PayPalBillingPlan } from './subscription/entities/paypal-billing-plan.entity';
import { PayPalSubscription } from './subscription/entities/paypal-subscription.entity';
import { PayPalSubscriptionResolver } from './subscription/paypal-subscription.resolver';
import { PayPalSubscriptionService } from './subscription/paypal-subscription.service';
import { PayPalPluginOptions } from './types';

@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [
        PayPalHttpClient,
        {
            provide: PAYPAL_PLUGIN_OPTIONS,
            useFactory: () => PayPalPlugin.options,
        },
        PayPalSubscriptionService,
        PayPalReportingService,
        PayPalShipmentTrackingService,
    ],
    entities: [PayPalBillingPlan, PayPalSubscription],
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [PayPalSubscriptionResolver, PayPalReportingResolver],
    },
    compatibility: '^3.0.0',
    configuration: config => {
        config.paymentOptions.paymentMethodHandlers.push(paypalPaymentHandler);
        config.paymentOptions.process = [
            ...(config.paymentOptions.process ?? []),
            paypalPaymentProcess,
        ];
        return config;
    },
})
export class PayPalPlugin {
    private static options: PayPalPluginOptions;

    /**
     * Initialise the plugin with your PayPal credentials and environment.
     *
     * ```ts
     * PayPalPlugin.init({
     *   clientId: process.env.PAYPAL_CLIENT_ID,
     *   clientSecret: process.env.PAYPAL_CLIENT_SECRET,
     *   environment: 'sandbox',
     * })
     * ```
     */
    static init(options: PayPalPluginOptions): Type<PayPalPlugin> {
        PayPalPlugin.options = options;
        return PayPalPlugin;
    }
}
