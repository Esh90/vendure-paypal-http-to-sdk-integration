import { PaymentProcess } from '@vendure/core';

/**
 * Extends the payment state machine with an AwaitingApproval state used by
 * AUTHORIZE intent payments.
 *
 * createPayment lands here (not Authorized) because at that point the PayPal
 * order exists but the buyer has not yet visited PayPal — no funds are reserved.
 * The order stays in ArrangingPayment until settlePayment runs after approval.
 *
 * Allowed transitions out of AwaitingApproval:
 *   → Settled   settlePayment succeeded (authorize + capture after buyer approval)
 *   → Cancelled cancelPayment called before buyer approved
 *   → Error     settlePayment failed
 *   → Declined  PayPal declined the authorization
 */

declare module '@vendure/core' {
    interface PaymentStates {
        AwaitingApproval: never;
    }
}

export const paypalPaymentProcess: PaymentProcess<'AwaitingApproval'> = {
    transitions: {
        // Allows createPayment to land here for AUTHORIZE intent.
        // mergeTransitionDefinitions concatenates this with the default Created.to,
        // so the full set becomes [Authorized, Settled, Declined, Error, Cancelled, AwaitingApproval].
        Created: {
            to: ['AwaitingApproval'],
        },
        AwaitingApproval: {
            to: ['Settled', 'Cancelled', 'Error', 'Declined'],
        },
    },
};
