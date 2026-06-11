import gql from 'graphql-tag';

export const subscriptionApiExtensions = gql`
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

    extend type Query {
        payPalBillingPlans: PayPalBillingPlanList!
        payPalSubscriptions: PayPalSubscriptionList!
        payPalSubscription(id: ID!): PayPalSubscription
    }

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
