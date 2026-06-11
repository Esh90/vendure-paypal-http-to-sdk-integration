// ─── Plugin configuration ────────────────────────────────────────────────────

export type PayPalEnvironment = 'sandbox' | 'production';

export interface PayPalPluginOptions {
    clientId: string;
    clientSecret: string;
    environment: PayPalEnvironment;
    /** Required for webhook signature verification (Feature 5). */
    webhookId?: string;
}

// ─── OAuth ───────────────────────────────────────────────────────────────────

export interface PayPalTokenResponse {
    access_token: string;
    token_type: string;
    /** Lifetime in seconds. */
    expires_in: number;
    scope: string;
}

// ─── Shared primitives ────────────────────────────────────────────────────────

export interface PayPalMoney {
    currency_code: string;
    /** Decimal string, e.g. "10.00". */
    value: string;
}

export interface PayPalLink {
    href: string;
    rel: string;
    method: string;
}

// ─── Orders API ──────────────────────────────────────────────────────────────

export interface PayPalPurchaseUnitRequest {
    reference_id?: string;
    amount: PayPalMoney;
}

export interface PayPalCreateOrderRequest {
    intent: 'CAPTURE' | 'AUTHORIZE';
    purchase_units: PayPalPurchaseUnitRequest[];
    payment_source?: {
        paypal?: {
            experience_context?: {
                return_url?: string;
                cancel_url?: string;
                /** Controls the approval button label. PAY_NOW finalises immediately; CONTINUE shows a review step. */
                user_action?: 'PAY_NOW' | 'CONTINUE';
            };
        };
    };
}

export interface PayPalCaptureDetails {
    id: string;
    status: 'COMPLETED' | 'DECLINED' | 'PARTIALLY_REFUNDED' | 'PENDING' | 'REFUNDED';
    amount?: PayPalMoney;
    final_capture?: boolean;
    seller_protection?: {
        status: string;
        dispute_categories?: string[];
    };
    create_time?: string;
    update_time?: string;
}

export interface PayPalAuthorizationDetails {
    id: string;
    status:
        | 'CREATED'
        | 'CAPTURED'
        | 'DENIED'
        | 'EXPIRED'
        | 'PARTIALLY_CAPTURED'
        | 'VOIDED'
        | 'PENDING';
    amount?: PayPalMoney;
    expiration_time?: string;
    create_time?: string;
    update_time?: string;
}

export interface PayPalOrderResponse {
    id: string;
    status:
        | 'CREATED'
        | 'SAVED'
        | 'APPROVED'
        | 'VOIDED'
        | 'COMPLETED'
        | 'PAYER_ACTION_REQUIRED';
    links: PayPalLink[];
    purchase_units: Array<{
        reference_id?: string;
        amount?: PayPalMoney;
        payments?: {
            captures?: PayPalCaptureDetails[];
            authorizations?: PayPalAuthorizationDetails[];
        };
    }>;
    create_time?: string;
    update_time?: string;
}

// ─── Billing Plans API ───────────────────────────────────────────────────────

export type PayPalIntervalUnit = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

export interface PayPalBillingCycle {
    frequency: {
        interval_unit: PayPalIntervalUnit;
        interval_count: number;
    };
    tenure_type: 'REGULAR' | 'TRIAL';
    sequence: number;
    total_cycles: number;
    pricing_scheme?: {
        fixed_price: PayPalMoney;
    };
}

export interface PayPalCreatePlanRequest {
    product_id: string;
    name: string;
    description?: string;
    billing_cycles: PayPalBillingCycle[];
    payment_preferences: {
        auto_bill_outstanding: boolean;
        setup_fee_failure_action: 'CONTINUE' | 'CANCEL';
        payment_failure_threshold: number;
        setup_fee?: PayPalMoney;
    };
}

export interface PayPalPlanResponse {
    id: string;
    product_id: string;
    name: string;
    description?: string;
    status: 'CREATED' | 'INACTIVE' | 'ACTIVE';
    billing_cycles?: PayPalBillingCycle[];
    create_time?: string;
    update_time?: string;
    links?: PayPalLink[];
}

// ─── Subscriptions API ────────────────────────────────────────────────────────

export interface PayPalCreateSubscriptionRequest {
    plan_id: string;
    start_time?: string;
    subscriber?: {
        name?: { given_name?: string; surname?: string };
        email_address?: string;
    };
    application_context?: {
        brand_name?: string;
        return_url?: string;
        cancel_url?: string;
        user_action?: 'SUBSCRIBE_NOW' | 'CONTINUE';
    };
}

export interface PayPalSubscriptionResponse {
    id: string;
    plan_id: string;
    status: 'APPROVAL_PENDING' | 'APPROVED' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'EXPIRED';
    start_time?: string;
    create_time?: string;
    update_time?: string;
    subscriber?: {
        name?: { given_name?: string; surname?: string };
        email_address?: string;
    };
    billing_info?: {
        outstanding_balance?: PayPalMoney;
        last_failed_payment?: {
            reason_code?: string;
            amount?: PayPalMoney;
            time?: string;
        };
    };
    links?: PayPalLink[];
}

// ─── Refunds API ─────────────────────────────────────────────────────────────

export interface PayPalRefundResponse {
    id: string;
    status: 'CANCELLED' | 'FAILED' | 'PENDING' | 'COMPLETED';
    amount?: PayPalMoney;
    note?: string;
    seller_payable_breakdown?: {
        gross_amount: PayPalMoney;
        paypal_fee: PayPalMoney;
        net_amount: PayPalMoney;
        total_refunded_amount?: PayPalMoney;
    };
    create_time?: string;
    update_time?: string;
}

// ─── Reporting API ───────────────────────────────────────────────────────────

export interface PayPalTransactionDetail {
    transaction_info: {
        paypal_account_id?: string;
        transaction_id: string;
        transaction_status?: string;
        transaction_subject?: string;
        transaction_amount?: PayPalMoney;
        fee_amount?: PayPalMoney;
        transaction_initiation_date?: string;
        transaction_updated_date?: string;
    };
    payer_info?: {
        email_address?: string;
        payer_name?: {
            given_name?: string;
            surname?: string;
        };
    };
}

export interface PayPalTransactionSearchResponse {
    transaction_details?: PayPalTransactionDetail[];
    total_items?: number;
    total_pages?: number;
    page?: number;
    last_refreshed_datetime?: string;
}

export interface PayPalBalanceDetail {
    currency: string;
    primary?: boolean;
    total_balance: PayPalMoney;
    available_balance?: PayPalMoney;
    withheld_balance?: PayPalMoney;
}

export interface PayPalBalancesResponse {
    balances?: PayPalBalanceDetail[];
    as_of_time?: string;
    last_refresh_time?: string;
}

// ─── Shipment Tracking API ────────────────────────────────────────────────────

export interface PayPalTrackingResponse {
    id: string;
    capture_id: string;
    tracking_number?: string;
    carrier?: string;
    status?: string;
    notify_payer?: boolean;
    create_time?: string;
    update_time?: string;
}

// ─── Error shape returned by PayPal on 4xx/5xx ───────────────────────────────

export interface PayPalApiErrorDetail {
    issue: string;
    description: string;
    field?: string;
    value?: string;
}

export interface PayPalApiErrorBody {
    name: string;
    message: string;
    details?: PayPalApiErrorDetail[];
    debug_id?: string;
    links?: PayPalLink[];
}
