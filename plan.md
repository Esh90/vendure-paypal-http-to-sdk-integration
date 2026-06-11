# PayPal Integration Plan — Vendure

## Overview

Integrate PayPal as a payment provider into the Vendure e-commerce platform. The integration is structured as a self-contained Vendure plugin that covers standard checkout, refunds, cancellations, recurring billing, and transaction reporting.

---

## Use Cases

### 1. Standard Checkout (Immediate Capture)

A customer completes checkout and payment is captured immediately.

**Flow:**
1. Customer proceeds to checkout on the storefront
2. Backend creates a PayPal order with capture intent
3. Customer is directed to PayPal to approve the payment (redirect or embedded UI)
4. After approval, backend captures the payment
5. Order is marked as paid in Vendure

**Success state:** Payment settled, order fulfilled
**Failure state:** Capture declined — order remains unpaid, customer is notified

---

### 2. Authorize-then-Capture

Payment is authorized at checkout but not captured until the merchant is ready (e.g., before shipment).

**Flow:**
1. Customer completes checkout
2. Backend creates a PayPal order with authorize intent
3. Customer approves the payment
4. Backend authorizes (reserves) the funds — no money moves yet
5. When merchant fulfills the order, backend captures the authorized funds
6. Order is marked as paid

**Success state:** Funds captured on fulfillment
**Failure state:** Authorization expired — PayPal authorizations are valid for 29 days; capture window is 3 days after re-authorization

---

### 3. Payment Cancellation / Void

An authorized-but-not-yet-captured payment is cancelled.

**Flow:**
1. Merchant cancels the order (or customer requests cancellation) before capture
2. Backend voids the authorization, releasing the reserved funds back to the customer
3. Order is marked as cancelled in Vendure

**Constraint:** Voiding is only possible on authorized payments that have not been fully captured.

---

### 4. Full Refund

A completed (captured) payment is refunded in full.

**Flow:**
1. Merchant initiates a full refund from the admin panel
2. Backend submits a refund request to PayPal with no amount specified (full refund)
3. PayPal reverses the captured amount back to the customer
4. Refund record is created and linked to the original payment in Vendure

---

### 5. Partial Refund

A portion of a captured payment is refunded.

**Flow:**
1. Merchant specifies a refund amount (less than the total) from the admin panel
2. Backend submits a refund request with the specific amount
3. PayPal processes the partial refund
4. Refund record is created in Vendure with the refunded amount

**Note:** Multiple partial refunds can be issued against the same capture, up to the original captured amount.

---

### 6. Subscription Billing (Recurring Payments)

A customer subscribes to a product or service that bills on a recurring schedule.

**Flow:**

**Setup (merchant):**
1. Merchant creates a billing plan defining the pricing and billing interval (daily, weekly, monthly, etc.)
2. Merchant activates the billing plan

**Subscription (customer):**
3. Customer selects a subscription product and is directed to PayPal to approve recurring charges
4. After approval, the subscription is activated in Vendure
5. PayPal automatically charges the customer on each billing cycle

**Management:**
- Merchant can view all active subscriptions from the admin panel
- Customer or merchant can cancel a subscription at any time
- Merchant can update billing plan details (pricing, failure thresholds)
- Failed payments can be retried via manual capture

---

### 7. Transaction Reporting

Merchants can view PayPal account activity and balances from within the Vendure admin.

**Flow:**
1. Merchant opens the reporting section in the admin panel
2. Backend queries PayPal for transactions within a selected date range
3. Results are displayed with transaction status, amounts, and timestamps

**Constraints:**
- Transactions appear in reports with up to a 3-hour delay after execution
- A single query supports a maximum 31-day date range; longer periods require multiple queries stitched together
- Intended for reconciliation and accounting only — not for real-time payment confirmation

---

### 8. Order Shipment Tracking

After an order is fulfilled, tracking information is attached to the PayPal payment for buyer visibility.

**Flow:**
1. Merchant fulfills the order and enters shipment tracking details in Vendure
2. Backend pushes the carrier and tracking number to PayPal
3. PayPal displays tracking information to the buyer in their PayPal account

---

## Architecture

### Plugin Structure

The integration lives in a single Vendure plugin (`paypal-plugin`) with five internal modules, each derived from Vendure's existing extension points:

**Payment Handler**
- Implements Vendure's built-in `PaymentMethodHandler` class
- Covers use cases 1–5 (checkout, authorize, void, full refund, partial refund)
- The handler's four lifecycle methods (`createPayment`, `settlePayment`, `cancelPayment`, `createRefund`) map directly to the corresponding PayPal operations
- Stores PayPal-specific identifiers (order ID, authorization ID, capture ID) in Vendure's `payment.metadata` field for use in downstream operations

**Subscription Module**
- Subscriptions do not fit into `PaymentMethodHandler` — that interface is designed for single order payments only
- Implemented as a separate NestJS module inside the plugin with its own TypeORM entities, service, and GraphQL resolvers
- Covers use case 6 (billing plan lifecycle, subscription activation, cancellation, failed payment retry)
- Uses Vendure's `Scheduler` service for recurring tasks

**Reporting Module**
- Custom Admin API GraphQL resolvers added via the plugin's `adminApiExtensions`
- Proxies transaction and balance queries to PayPal and returns formatted results
- Covers use case 7 (transaction search, balance lookup)
- No Vendure entities required — data is fetched live from PayPal

**Fulfillment Hook**
- Subscribes to Vendure's `EventBus` for fulfillment state transition events
- When an order moves to a fulfilled state, the hook pushes shipment tracking data to PayPal
- Covers use case 8 — no custom endpoints or entities needed

**Webhook Module**
- Exposes a `POST /paypal/webhook` endpoint implemented as a standard NestJS `@Controller` registered in the plugin's `controllers` array
- Verifies every incoming payload before processing using self-cryptographic verification: downloads PayPal's certificate from the `PAYPAL-CERT-URL` header, caches it, and validates the RSA-SHA256 signature locally against the pipe-delimited string of `transmission_id|transmission_time|webhook_id|crc32(body)`
- Persists processed event IDs to a `paypal_webhook_event` table to guarantee idempotent handling during PayPal's automatic retry attempts
- Handles the following event types at minimum:
  - `PAYMENT.CAPTURE.COMPLETED` — confirms a capture settled asynchronously
  - `PAYMENT.CAPTURE.DENIED` — marks an order unpaid if capture is rejected post-approval
  - `BILLING.SUBSCRIPTION.ACTIVATED` — activates a subscription record in Vendure
  - `BILLING.SUBSCRIPTION.CANCELLED` — cancels a subscription record in Vendure
  - `PAYMENT.SALE.COMPLETED` — records a successful recurring billing cycle charge

---

### HTTP Client Module

All PayPal communication is handled through a single internal HTTP client module. No SDK is used — every call is a direct HTTP request.

**Token management**
- Server-to-server OAuth 2.0 Client Credentials flow via `POST /v1/oauth2/token` with Basic auth (`base64(client_id:secret)`)
- Credentials loaded from environment variables (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`)
- Access token cached in memory alongside its `expires_in` value
- Token refreshed proactively 60 seconds before expiry — not reactively on 401 — to avoid failed requests at the boundary
- All outgoing requests routed through this module so token logic is never duplicated elsewhere

**Idempotency**
- Every state-mutating `POST` (create order, authorize, capture, void, refund) includes a `PayPal-Request-Id` header
- The idempotency key is derived deterministically from the Vendure order or payment ID for that operation (e.g. `capture-${paymentId}`)
- This ensures safe retries on network timeouts without risk of duplicate charges or double refunds

**Environment**
- Base URL toggled via `PAYPAL_ENVIRONMENT` (`sandbox` → `api-m.sandbox.paypal.com`, `production` → `api-m.paypal.com`)

---

### Frontend Requirement

Checkout flows (use cases 1 and 2) require the storefront to handle the buyer approval step. Two supported options:

**Redirect flow**
Backend returns a PayPal approval URL; storefront redirects the customer to PayPal and handles the return callback with the approved order ID

**Embedded flow**
PayPal JS SDK (Smart Payment Buttons) — a browser-side JavaScript library, not a server-side SDK — handles approval in-browser; storefront passes the approved order ID back to the Vendure backend to complete capture. This does not conflict with the HTTP-only rule, which applies to server-side PayPal communication only.

Both options terminate at the same backend capture call — the plugin supports both without changes to the handler.

---

## Testing Strategy

- All flows tested against PayPal Sandbox using test buyer and merchant accounts
- Negative scenarios (declined payments, insufficient funds, duplicate refunds, conflict errors) tested using PayPal's mock response header support in sandbox
- Unit tests mock at the HTTP transport layer (intercepting `fetch` or whichever HTTP client is used) — not at any SDK client level, as no SDK is present
- Integration tests run against PayPal Sandbox with real credentials in a `.env.test` file
- Each use case has a defined happy path and at least one failure scenario

---

## Out of Scope

- Vault / saved payment methods — US-only feature, excluded from this integration
- Dispute and chargeback management — handled directly in the PayPal merchant dashboard
- PayPal Payouts — separate use case, not part of this integration
- Cryptocurrency payments via PayPal — not supported by the server SDK
