import Cloudflare from 'cloudflare';

export interface TokenHealth {
    passed: boolean;
    reason?: string;
    detectedType?: 'user' | 'account';
    details?: any;
}

/**
 * Verifies a Cloudflare token.
 * * Strategy:
 * 1. Checks Account Level Access. 
 * - If `env.CLOUDFLARE_ACCOUNT_ID` is present, it verifies access to that specific account.
 * - Otherwise, it checks if the token can list any accounts.
 * 2. If Account checks fail, it falls back to the User Token Verify endpoint.
 * * @param env The environment object containing configuration (e.g. CLOUDFLARE_ACCOUNT_ID)
 * @param token The API token to test
 * @param expectedType Optional. If provided, the function will mark `passed: false` if the detected type does not match.
 */
export async function testToken(
    env: Env,
    token: string,
    expectedType: 'user' | 'account' = 'account'
): Promise<TokenHealth> {

    const client = new Cloudflare({
        apiToken: token,
    });

    let detectedType: 'user' | 'account' | undefined;
    let details: any;
    let failureReason: string | undefined;

    // ---------------------------------------------------------
    // STEP 1: Check Account Level Access
    // ---------------------------------------------------------
    try {
        if (env.CLOUDFLARE_ACCOUNT_ID) {
            // If we have a specific account ID, verify we can access IT specifically
            const account = await client.accounts.get({ account_id: env.CLOUDFLARE_ACCOUNT_ID });
            if (account) {
                detectedType = 'account';
                details = account;
            }
        } else {
            // Otherwise, just check if we can list ANY accounts
            const accounts = await client.accounts.list({ per_page: 1 });
            if (accounts) {
                detectedType = 'account';
                details = accounts;
            }
        }
    } catch (err) {
        // Silently fail step 1 and capture error for potential debugging
        failureReason = err instanceof Error ? err.message : String(err);
        // console.warn("Account token check failed, falling back to user verify");
    }

    // ---------------------------------------------------------
    // STEP 2: Check User Verify Endpoint (Fallback)
    // ---------------------------------------------------------
    if (!detectedType) {
        try {
            const verify = await client.user.tokens.verify();

            if (verify.status === 'active') {
                // If we failed the specific account check (Step 1) but the token is valid (Step 2),
                // it is likely a narrowly scoped Account Token (e.g. AI Gateway only).
                // If the caller expected 'account', we assume it IS 'account' to avoid false positive type mismatches.
                // Otherwise, default to 'user' (traditional API keys/tokens).
                detectedType = (expectedType === 'account') ? 'account' : 'user';
                details = { ...verify, note: "Validated via user.tokens.verify (likely narrow scope)" };
            } else {
                return {
                    passed: false,
                    reason: `Token status: ${verify.status}`,
                    details: verify
                };
            }
        } catch (err) {
            // If both failed, return the failure
            return {
                passed: false,
                reason: `Validation failed. Account check error: [${failureReason}]. User verify error: [${err instanceof Error ? err.message : String(err)}]`
            };
        }
    }

    // ---------------------------------------------------------
    // STEP 3: Final Validation
    // ---------------------------------------------------------

    // If we detected a type, the token is valid in the eyes of Cloudflare.
    // Now we check if it matches the user's specific expectations (if any).
    if (detectedType) {
        if (expectedType && expectedType !== detectedType) {
            return {
                passed: false,
                reason: `Token valid but type mismatch. Expected '${expectedType}' but detected '${detectedType}'.`,
                detectedType,
                details
            };
        }

        return {
            passed: true,
            detectedType,
            details
        };
    }

    return { passed: false, reason: "Unknown validation error" };
}