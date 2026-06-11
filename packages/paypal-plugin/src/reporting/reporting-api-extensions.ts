import gql from 'graphql-tag';

export const reportingApiExtensions = gql`
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
        primary: Boolean!
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

    extend type Query {
        "Search PayPal account transactions within a date range (max 31 days). Results may lag up to 3 hours."
        payPalTransactions(input: PayPalTransactionSearchInput!): PayPalTransactionReport!
        "Retrieve current PayPal account balances, optionally filtered by currency or as-of time."
        payPalBalances(asOfTime: String, currencyCode: String): [PayPalAccountBalance!]!
    }
`;
