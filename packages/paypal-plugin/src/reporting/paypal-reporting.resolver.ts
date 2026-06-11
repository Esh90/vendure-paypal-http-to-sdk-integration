import { Args, Query, Resolver } from '@nestjs/graphql';
import { Allow, Permission } from '@vendure/core';

import { PayPalReportingService, TransactionSearchInput } from './paypal-reporting.service';

@Resolver()
export class PayPalReportingResolver {
    constructor(private readonly reportingService: PayPalReportingService) {}

    @Allow(Permission.SuperAdmin)
    @Query()
    payPalTransactions(@Args('input') input: TransactionSearchInput) {
        return this.reportingService.searchTransactions(input);
    }

    @Allow(Permission.SuperAdmin)
    @Query()
    payPalBalances(
        @Args('asOfTime', { nullable: true }) asOfTime?: string,
        @Args('currencyCode', { nullable: true }) currencyCode?: string,
    ) {
        return this.reportingService.getBalances(asOfTime, currencyCode);
    }
}
