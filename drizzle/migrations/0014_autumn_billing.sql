-- Autumn replaces the direct Stripe integration as the billing source of truth
-- (Autumn still drives Stripe underneath). `billing_synced_at` timestamps the D1
-- entitlement mirror so a stale mirror can be refreshed from Autumn — without it
-- a cancellation that misses the webhook would never propagate and the customer
-- would keep Pro forever.
ALTER TABLE `user_profiles` ADD `billing_synced_at` integer;
