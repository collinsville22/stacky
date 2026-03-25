
(define-constant ERR-NOT-AUTHORIZED (err u1000))
(define-constant ERR-INVALID-AMOUNT (err u1001))
(define-constant ERR-PAUSED (err u1003))
(define-constant ERR-INSUFFICIENT-BALANCE (err u6011))
(define-constant ERR-INVALID-MATCH-TYPE (err u6030))
(define-constant ERR-ORDER-ALREADY-FILLED (err u6031))
(define-constant ERR-MARKET-NOT-RESOLVED (err u6032))

(define-constant ONE_8 u100000000)
(define-constant MATCH-COMPLEMENTARY u0)
(define-constant MATCH-MINT u1)
(define-constant MATCH-MERGE u2)

(define-constant FEE_RATE u25000000)
(define-constant MIN_FEE u1)

(define-data-var protocol-fees uint u0)
(define-data-var trade-nonce uint u0)

(define-map token-balances { token-id: uint, owner: principal } uint)

(define-map sbtc-balances principal uint)

(define-map filled-orders uint bool)
(define-private (get-token-balance (token-id uint) (owner principal))
  (default-to u0 (map-get? token-balances { token-id: token-id, owner: owner }))
)

(define-private (get-sbtc-balance (owner principal))
  (default-to u0 (map-get? sbtc-balances owner))
)

(define-private (calculate-dynamic-fee (amount uint) (price uint))
  (let
    (
      (clamped-price (contract-call? .stacky-math max price u1))
      (clamped-high (contract-call? .stacky-math min clamped-price (- ONE_8 u1)))
      (p-comp (- ONE_8 clamped-high))
      (variance (contract-call? .stacky-math mul-down clamped-high p-comp))
      (variance-sq (contract-call? .stacky-math mul-down variance variance))
      (notional (contract-call? .stacky-math mul-down amount clamped-high))
      (raw-fee (contract-call? .stacky-math mul-down
        (contract-call? .stacky-math mul-down notional FEE_RATE)
        variance-sq))
    )
    (contract-call? .stacky-math max raw-fee MIN_FEE)
  )
)

(define-private (debit-sbtc (user principal) (amount uint))
  (let ((bal (get-sbtc-balance user)))
    (asserts! (>= bal amount) ERR-INSUFFICIENT-BALANCE)
    (map-set sbtc-balances user (- bal amount))
    (ok true)
  )
)

(define-private (credit-sbtc (user principal) (amount uint))
  (begin
    (map-set sbtc-balances user (+ (get-sbtc-balance user) amount))
    true
  )
)
(define-public (deposit-sbtc (amount uint))
  (let
    (
      (caller tx-sender)
    )
    (asserts! (> amount u0) ERR-INVALID-AMOUNT)
    ;; User transfers sBTC to exchange contract
    (try! (contract-call? .sbtc-token transfer amount caller (as-contract tx-sender) none))
    (map-set sbtc-balances caller (+ (get-sbtc-balance caller) amount))
    (print { event: "deposit-sbtc", user: caller, amount: amount })
    (ok true)
  )
)

(define-public (withdraw-sbtc (amount uint))
  (let
    (
      (caller tx-sender)
      (bal (get-sbtc-balance caller))
    )
    (asserts! (> amount u0) ERR-INVALID-AMOUNT)
    (asserts! (>= bal amount) ERR-INSUFFICIENT-BALANCE)
    ;; Exchange transfers sBTC back to user
    (try! (as-contract (contract-call? .sbtc-token transfer amount tx-sender caller none)))
    (map-set sbtc-balances caller (- bal amount))
    (print { event: "withdraw-sbtc", user: caller, amount: amount })
    (ok true)
  )
)

(define-public (deposit-tokens (token-id uint) (amount uint))
  (let
    (
      (caller tx-sender)
      (exchange-principal (as-contract tx-sender))
    )
    (asserts! (> amount u0) ERR-INVALID-AMOUNT)
    (try! (contract-call? .stacky-outcome-tokens-v3 transfer token-id amount caller exchange-principal))
    (map-set token-balances { token-id: token-id, owner: caller }
      (+ (get-token-balance token-id caller) amount))
    (print { event: "deposit-tokens", user: caller, token-id: token-id, amount: amount })
    (ok true)
  )
)
(define-public (fill-order
    (market-id uint)
    (maker principal)
    (taker principal)
    (side bool)
    (amount uint)
    (price uint)
    (match-type uint)
    (order-nonce uint))
  (let
    (
      (yes-id (contract-call? .stacky-outcome-tokens-v3 get-yes-token-id market-id))
      (no-id (contract-call? .stacky-outcome-tokens-v3 get-no-token-id market-id))
      (sbtc-cost (/ (* amount price) ONE_8))
      (fee (calculate-dynamic-fee amount price))
      (net-cost (if (> sbtc-cost fee) (- sbtc-cost fee) u0))
      (trade-id (var-get trade-nonce))
    )
    (asserts! (not (contract-call? .stacky-governance-v2 get-paused)) ERR-PAUSED)
    (asserts! (contract-call? .stacky-governance-v2 is-authorized contract-caller) ERR-NOT-AUTHORIZED)
    (asserts! (> amount u0) ERR-INVALID-AMOUNT)
    (asserts! (> price u0) ERR-INVALID-AMOUNT)
    (asserts! (< price ONE_8) ERR-INVALID-AMOUNT)
    ;; FIX Bug 8: prevent replay
    (asserts! (is-none (map-get? filled-orders order-nonce)) ERR-ORDER-ALREADY-FILLED)
    (map-set filled-orders order-nonce true)

    (if (is-eq match-type MATCH-COMPLEMENTARY)
      ;; Taker buys tokens from maker: taker pays sBTC, maker gives tokens
      (let
        (
          (token-id (if side yes-id no-id))
          (maker-tok-bal (get-token-balance token-id maker))
        )
        (asserts! (>= maker-tok-bal amount) ERR-INSUFFICIENT-BALANCE)

        ;; Debit sBTC from taker's escrow
        (try! (debit-sbtc taker sbtc-cost))
        ;; Credit maker (minus fee)
        (if (> net-cost u0)
          (credit-sbtc maker net-cost)
          true
        )

        ;; Transfer tokens in escrow
        (map-set token-balances { token-id: token-id, owner: maker }
          (- maker-tok-bal amount))
        (map-set token-balances { token-id: token-id, owner: taker }
          (+ (get-token-balance token-id taker) amount))

        (var-set protocol-fees (+ (var-get protocol-fees) fee))
        (var-set trade-nonce (+ trade-id u1))
        (print {
          event: "trade", trade-id: trade-id, market-id: market-id,
          match-type: "complementary", maker: maker, taker: taker,
          side: side, amount: amount, price: price, fee: fee,
          order-nonce: order-nonce
        })
        (ok trade-id)
      )

      (if (is-eq match-type MATCH-MINT)
        ;; Both buyers pay sBTC, receive outcome tokens
        (let
          (
            (yes-buyer (if side taker maker))
            (no-buyer (if side maker taker))
            (yes-cost (/ (* amount price) ONE_8))
            (no-cost (- amount yes-cost))
            (yes-fee (calculate-dynamic-fee amount price))
            (no-fee (calculate-dynamic-fee amount (- ONE_8 price)))
            (total-fee (+ yes-fee no-fee))
          )
          ;; Debit sBTC from both buyers' escrow
          (try! (debit-sbtc yes-buyer (+ yes-cost yes-fee)))
          (try! (debit-sbtc no-buyer (+ no-cost no-fee)))

          ;; Credit tokens
          (map-set token-balances { token-id: yes-id, owner: yes-buyer }
            (+ (get-token-balance yes-id yes-buyer) amount))
          (map-set token-balances { token-id: no-id, owner: no-buyer }
            (+ (get-token-balance no-id no-buyer) amount))

          (var-set protocol-fees (+ (var-get protocol-fees) total-fee))
          (var-set trade-nonce (+ trade-id u1))
          (print {
            event: "trade", trade-id: trade-id, market-id: market-id,
            match-type: "mint", maker: maker, taker: taker,
            side: side, amount: amount, price: price, fee: total-fee,
            order-nonce: order-nonce
          })
          (ok trade-id)
        )

        (if (is-eq match-type MATCH-MERGE)
          ;; Both sellers give tokens, receive sBTC
          (let
            (
              (yes-seller (if side maker taker))
              (no-seller (if side taker maker))
              (yes-seller-tok (get-token-balance yes-id yes-seller))
              (no-seller-tok (get-token-balance no-id no-seller))
              (yes-payout (/ (* amount price) ONE_8))
              (no-payout (- amount yes-payout))
              (yes-fee (calculate-dynamic-fee amount price))
              (no-fee (calculate-dynamic-fee amount (- ONE_8 price)))
              (total-fee (+ yes-fee no-fee))
            )
            (asserts! (>= yes-seller-tok amount) ERR-INSUFFICIENT-BALANCE)
            (asserts! (>= no-seller-tok amount) ERR-INSUFFICIENT-BALANCE)

            ;; Burn tokens from escrow
            (map-set token-balances { token-id: yes-id, owner: yes-seller }
              (- yes-seller-tok amount))
            (map-set token-balances { token-id: no-id, owner: no-seller }
              (- no-seller-tok amount))

            ;; Credit sBTC to sellers (minus fees)
            (if (> yes-payout yes-fee)
              (credit-sbtc yes-seller (- yes-payout yes-fee))
              true
            )
            (if (> no-payout no-fee)
              (credit-sbtc no-seller (- no-payout no-fee))
              true
            )

            (var-set protocol-fees (+ (var-get protocol-fees) total-fee))
            (var-set trade-nonce (+ trade-id u1))
            (print {
              event: "trade", trade-id: trade-id, market-id: market-id,
              match-type: "merge", maker: maker, taker: taker,
              side: side, amount: amount, price: price, fee: total-fee,
              order-nonce: order-nonce
            })
            (ok trade-id)
          )

          ERR-INVALID-MATCH-TYPE
        )
      )
    )
  )
)
(define-public (withdraw-tokens (token-id uint) (amount uint))
  (let
    (
      (caller tx-sender)
      (bal (get-token-balance token-id caller))
    )
    (asserts! (> amount u0) ERR-INVALID-AMOUNT)
    (asserts! (>= bal amount) ERR-INSUFFICIENT-BALANCE)
    (try! (as-contract (contract-call? .stacky-outcome-tokens-v3 transfer token-id amount tx-sender caller)))
    (map-set token-balances { token-id: token-id, owner: caller } (- bal amount))
    (print { event: "withdraw-tokens", user: caller, token-id: token-id, amount: amount })
    (ok true)
  )
)
(define-public (redeem (market-id uint))
  (let
    (
      (caller tx-sender)
      (market (unwrap! (contract-call? .stacky-outcome-tokens-v3 get-market market-id) ERR-MARKET-NOT-RESOLVED))
      (resolved (get resolved market))
      (outcome (get outcome market))
      (yes-id (contract-call? .stacky-outcome-tokens-v3 get-yes-token-id market-id))
      (no-id (contract-call? .stacky-outcome-tokens-v3 get-no-token-id market-id))
      (winning-id (if outcome yes-id no-id))
      (losing-id (if outcome no-id yes-id))
      (winning-bal (get-token-balance winning-id caller))
    )
    (asserts! resolved ERR-MARKET-NOT-RESOLVED)
    (asserts! (> winning-bal u0) ERR-INSUFFICIENT-BALANCE)

    ;; Credit sBTC to winner's escrow (they can withdraw-sbtc later)
    (credit-sbtc caller winning-bal)

    ;; Clear token balances
    (map-set token-balances { token-id: winning-id, owner: caller } u0)
    (map-set token-balances { token-id: losing-id, owner: caller } u0)

    (print { event: "redeemed", market-id: market-id, user: caller, amount: winning-bal })
    (ok winning-bal)
  )
)

(define-public (redeem-for (market-id uint) (user principal))
  (let
    (
      (market (unwrap! (contract-call? .stacky-outcome-tokens-v3 get-market market-id) ERR-MARKET-NOT-RESOLVED))
      (resolved (get resolved market))
      (outcome (get outcome market))
      (yes-id (contract-call? .stacky-outcome-tokens-v3 get-yes-token-id market-id))
      (no-id (contract-call? .stacky-outcome-tokens-v3 get-no-token-id market-id))
      (winning-id (if outcome yes-id no-id))
      (losing-id (if outcome no-id yes-id))
      (winning-bal (get-token-balance winning-id user))
    )
    (asserts! (contract-call? .stacky-governance-v2 is-authorized contract-caller) ERR-NOT-AUTHORIZED)
    (asserts! resolved ERR-MARKET-NOT-RESOLVED)
    (asserts! (> winning-bal u0) ERR-INSUFFICIENT-BALANCE)

    ;; Credit sBTC to winner's escrow
    (credit-sbtc user winning-bal)

    (map-set token-balances { token-id: winning-id, owner: user } u0)
    (map-set token-balances { token-id: losing-id, owner: user } u0)

    (print { event: "redeemed-for", market-id: market-id, user: user, amount: winning-bal })
    (ok winning-bal)
  )
)
(define-public (withdraw-fees (recipient principal))
  (let
    (
      (fees (var-get protocol-fees))
    )
    (asserts! (contract-call? .stacky-governance-v2 is-authorized contract-caller) ERR-NOT-AUTHORIZED)
    (asserts! (> fees u0) ERR-INVALID-AMOUNT)
    ;; Fees stay in the contract's sBTC balance, send to recipient
    (try! (as-contract (contract-call? .sbtc-token transfer fees tx-sender recipient none)))
    (var-set protocol-fees u0)
    (ok fees)
  )
)

(define-public (emergency-withdraw (market-id uint) (user principal))
  (let
    (
      (yes-id (contract-call? .stacky-outcome-tokens-v3 get-yes-token-id market-id))
      (no-id (contract-call? .stacky-outcome-tokens-v3 get-no-token-id market-id))
      (yes-bal (get-token-balance yes-id user))
      (no-bal (get-token-balance no-id user))
      (refund (contract-call? .stacky-math min yes-bal no-bal))
    )
    ;; Only owner can trigger emergency withdrawals
    (asserts! (contract-call? .stacky-governance-v2 is-authorized contract-caller) ERR-NOT-AUTHORIZED)
    (asserts! (> refund u0) ERR-INSUFFICIENT-BALANCE)

    ;; Burn equal token pairs and credit sBTC to user's escrow
    (map-set token-balances { token-id: yes-id, owner: user } (- yes-bal refund))
    (map-set token-balances { token-id: no-id, owner: user } (- no-bal refund))

    (credit-sbtc user refund)

    (print { event: "emergency-withdraw", market-id: market-id, user: user, amount: refund })
    (ok refund)
  )
)
(define-read-only (get-token-escrow (token-id uint) (owner principal))
  (get-token-balance token-id owner)
)

(define-read-only (get-sbtc-escrow (owner principal))
  (get-sbtc-balance owner)
)

(define-read-only (get-protocol-fees)
  (var-get protocol-fees)
)

(define-read-only (get-trade-count)
  (var-get trade-nonce)
)

(define-read-only (get-dynamic-fee (amount uint) (price uint))
  (calculate-dynamic-fee amount price)
)

(define-read-only (is-order-filled (order-nonce uint))
  (is-some (map-get? filled-orders order-nonce))
)
