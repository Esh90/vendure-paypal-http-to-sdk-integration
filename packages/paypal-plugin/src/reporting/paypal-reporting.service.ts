import { Injectable } from '@nestjs/common';
import { Logger } from '@vendure/core';

import { PayPalHttpClient } from '../http-client/paypal-http.client';
import {
    PayPalBalancesResponse,
    PayPalTransactionSearchResponse,
} from '../types';

const loggerCtx = 'PayPalReportingService';

export interface TransactionSearchInput {
    startDate: string;
    endDate: string;
    transactionId?: string | null;
    transactionStatus?: string | null;
    pageSize?: number | null;
    page?: number | null;
}

export interface TransactionReport {
    transactions: TransactionDetail[];
    totalItems: number;
    totalPages: number;
    page: number;
}

interface TransactionDetail {
    transactionId: string;
    transactionStatus: string | null;
    transactionSubject: string | null;
    transactionAmount: AmountDetail | null;
    feeAmount: AmountDetail | null;
    transactionInitiationDate: string | null;
    transactionUpdatedDate: string | null;
    payerInfo: PayerInfo | null;
}

interface AmountDetail {
    currencyCode: string;
    value: string;
}

interface PayerInfo {
    emailAddress: string | null;
    payerName: { givenName: string | null; surname: string | null } | null;
}

export interface AccountBalance {
    currency: string;
    primary: boolean | null;
    totalBalance: AmountDetail;
    availableBalance: AmountDetail | null;
    withheldBalance: AmountDetail | null;
}

@Injectable()
export class PayPalReportingService {
    constructor(private readonly httpClient: PayPalHttpClient) {}

    /**
     * Searches PayPal account transactions within the given date range.
     *
     * Constraints:
     * - Date range must not exceed 31 days.
     * - Transactions may appear up to 3 hours after execution.
     * - Intended for reconciliation only — not for real-time payment confirmation.
     */
    async searchTransactions(input: TransactionSearchInput): Promise<TransactionReport> {
        const params = new URLSearchParams({
            start_date: input.startDate,
            end_date: input.endDate,
            fields: 'all',
            page_size: String(Math.min(input.pageSize ?? 100, 500)),
            page: String(input.page ?? 1),
        });
        if (input.transactionId) params.set('transaction_id', input.transactionId);
        if (input.transactionStatus) params.set('transaction_status', input.transactionStatus);

        Logger.info(
            `PayPal transaction search: start=${input.startDate}, end=${input.endDate}`,
            loggerCtx,
        );

        const response = await this.httpClient.get<PayPalTransactionSearchResponse>(
            `/v1/reporting/transactions?${params.toString()}`,
        );

        const transactions = (response.transaction_details ?? []).map<TransactionDetail>(t => {
            const info = t.transaction_info;
            return {
                transactionId: info.transaction_id,
                transactionStatus: info.transaction_status ?? null,
                transactionSubject: info.transaction_subject ?? null,
                transactionAmount: info.transaction_amount
                    ? { currencyCode: info.transaction_amount.currency_code, value: info.transaction_amount.value }
                    : null,
                feeAmount: info.fee_amount
                    ? { currencyCode: info.fee_amount.currency_code, value: info.fee_amount.value }
                    : null,
                transactionInitiationDate: info.transaction_initiation_date ?? null,
                transactionUpdatedDate: info.transaction_updated_date ?? null,
                payerInfo: t.payer_info
                    ? {
                          emailAddress: t.payer_info.email_address ?? null,
                          payerName: t.payer_info.payer_name
                              ? {
                                    givenName: t.payer_info.payer_name.given_name ?? null,
                                    surname: t.payer_info.payer_name.surname ?? null,
                                }
                              : null,
                      }
                    : null,
            };
        });

        return {
            transactions,
            totalItems: response.total_items ?? 0,
            totalPages: response.total_pages ?? 0,
            page: response.page ?? 1,
        };
    }

    /**
     * Retrieves the current PayPal account balance(s).
     *
     * @param asOfTime  Optional ISO 8601 datetime to get a historical snapshot.
     * @param currencyCode  Optional currency filter (e.g. "USD").
     */
    async getBalances(
        asOfTime?: string | null,
        currencyCode?: string | null,
    ): Promise<AccountBalance[]> {
        const params = new URLSearchParams();
        if (asOfTime) params.set('as_of_time', asOfTime);
        if (currencyCode) params.set('currency_code', currencyCode);
        const qs = params.toString();

        const response = await this.httpClient.get<PayPalBalancesResponse>(
            `/v1/reporting/balances${qs ? `?${qs}` : ''}`,
        );

        return (response.balances ?? []).map<AccountBalance>(b => ({
            currency: b.currency,
            primary: b.primary ?? null,
            totalBalance: { currencyCode: b.total_balance.currency_code, value: b.total_balance.value },
            availableBalance: b.available_balance
                ? { currencyCode: b.available_balance.currency_code, value: b.available_balance.value }
                : null,
            withheldBalance: b.withheld_balance
                ? { currencyCode: b.withheld_balance.currency_code, value: b.withheld_balance.value }
                : null,
        }));
    }
}
