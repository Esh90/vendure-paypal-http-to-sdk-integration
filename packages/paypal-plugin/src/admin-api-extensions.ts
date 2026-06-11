import gql from 'graphql-tag';

/**
 * All Admin API GraphQL extensions for the PayPal plugin in a single document.
 * Vendure's extendSchema requires exactly one extend type Query and one
 * extend type Mutation per plugin — multiple documents merged by @graphql-tools
 * promote the extensions to base types, which GraphQL rejects.
 */
export const adminApiExtensions = gql`
    # ── Subscription types ──────────────────────────────────────────────────

    type PayPalBillingPlan {
        id: ID!
        paypalPlanId: String!
        name: String!
        description: String
        status: String!
        paypalProductId: String!
        intervalUnit: String!
        intervalCount: Int!
        price: String!
        currencyCode: String!
        createdAt: DateTime!
        updatedAt: DateTime!
    }

    type PayPalSubscription {
        id: ID!
        paypalSubscriptionId: String!
        paypalPlanId: String!
        vendureCustomerId: String
        status: String!
        approvalUrl: String
        startTime: String
        createdAt: DateTime!
        updatedAt: DateTime!
    }

    type PayPalBillingPlanList {
        items: [PayPalBillingPlan!]!
        totalItems: Int!
    }

    type PayPalSubscriptionList {
        items: [PayPalSubscription!]!
        totalItems: Int!
    }

    input CreatePayPalBillingPlanInput {
        "Existing PayPal Product ID to attach this plan to (create in the PayPal dashboard first)."
        productId: String!
        name: String!
        description: String
        "DAY | WEEK | MONTH | YEAR"
        intervalUnit: String!
        "How many interval units between charges (e.g. 1 for monthly, 3 for quarterly)."
        intervalCount: Int!
        "Decimal string price per cycle (e.g. \\"9.99\\")."
        price: String!
        currencyCode: String!
    }

    input CreatePayPalSubscriptionInput {
        "Vendure-side ID of the PayPalBillingPlan to subscribe to."
        planId: ID!
        "Vendure Customer ID — optional when subscription is initiated outside a customer session."
        customerId: ID
        returnUrl: String!
        cancelUrl: String!
        "Optional ISO 8601 start time (defaults to immediately)."
        startTime: String
    }

    # ── Reporting types ─────────────────────────────────────────────────────

    type PayPalTxAmount {
        currencyCode: String!
        value: String!
    }

    type PayPalTxPayerName {
        givenName: String
        surname: String
    }

    type PayPalTxPayerInfo {
        emailAddress: String
        payerName: PayPalTxPayerName
    }

    type PayPalTransactionDetail {
        transactionId: String!
        transactionStatus: String
        transactionSubject: String
        transactionAmount: PayPalTxAmount
        feeAmount: PayPalTxAmount
        transactionInitiationDate: String
        transactionUpdatedDate: String
        payerInfo: PayPalTxPayerInfo
    }

    type PayPalTransactionReport {
        transactions: [PayPalTransactionDetail!]!
        totalItems: Int!
        totalPages: Int!
        page: Int!
    }

    type PayPalAccountBalance {
        currency: String!
        primary: Boolean
        totalBalance: PayPalTxAmount!
        availableBalance: PayPalTxAmount
        withheldBalance: PayPalTxAmount
    }

    input PayPalTransactionSearchInput {
        "ISO 8601 datetime, e.g. 2024-01-01T00:00:00Z (must be within the last 3 years)."
        startDate: String!
        "ISO 8601 datetime — must be within 31 days of startDate."
        endDate: String!
        "Filter to a single PayPal transaction ID."
        transactionId: String
        "Filter by status: S=success, P=pending, V=reversed, etc."
        transactionStatus: String
        "Number of results per page — max 500, defaults to 100."
        pageSize: Int
        "1-based page number, defaults to 1."
        page: Int
    }

    # ── Single extend type Query ─────────────────────────────────────────────

    extend type Query {
        payPalBillingPlans: PayPalBillingPlanList!
        payPalSubscriptions: PayPalSubscriptionList!
        payPalSubscription(id: ID!): PayPalSubscription

        "Search PayPal account transactions within a date range (max 31 days). Results may lag up to 3 hours."
        payPalTransactions(input: PayPalTransactionSearchInput!): PayPalTransactionReport!
        "Retrieve current PayPal account balances, optionally filtered by currency or as-of time."
        payPalBalances(asOfTime: String, currencyCode: String): [PayPalAccountBalance!]!
    }

    # ── Single extend type Mutation ──────────────────────────────────────────

    extend type Mutation {
        "Creates a PayPal billing plan and saves it locally. The plan starts in CREATED status."
        createPayPalBillingPlan(input: CreatePayPalBillingPlanInput!): PayPalBillingPlan!
        "Activates a CREATED or INACTIVE plan so subscribers can attach to it."
        activatePayPalBillingPlan(id: ID!): PayPalBillingPlan!
        "Deactivates an ACTIVE plan — existing subscriptions continue but no new ones can be created."
        deactivatePayPalBillingPlan(id: ID!): PayPalBillingPlan!
        "Creates a subscription under an ACTIVE plan and returns the PayPal approval URL."
        createPayPalSubscription(input: CreatePayPalSubscriptionInput!): PayPalSubscription!
        "Cancels an active subscription on PayPal and marks it CANCELLED locally."
        cancelPayPalSubscription(id: ID!, reason: String): PayPalSubscription!
        "Retries capturing an outstanding balance for a subscription with a failed payment."
        retryPayPalSubscriptionPayment(id: ID!): Boolean!
    }
`;
