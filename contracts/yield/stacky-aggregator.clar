(define-constant ERR-NOT-AUTHORIZED (err u1000))
(define-constant ERR-INVALID-AMOUNT (err u1001))
(define-constant ERR-INSUFFICIENT-BALANCE (err u1002))
(define-constant ERR-PAUSED (err u1003))
(define-constant ERR-INVALID-STRATEGY (err u7001))
(define-constant ERR-BELOW-MINIMUM (err u7002))
(define-constant ERR-STRATEGY-FULL (err u7003))

(define-constant ONE_8 u100000000)
(define-constant ONE_6 u1000000)

(define-constant STRATEGY-CARRY u1)
(define-constant STRATEGY-HERMETICA u2)
(define-constant STRATEGY-MIXED u3)

(define-constant REAL-SBTC 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token)
(define-constant ZEST-SBTC-VAULT 'SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-vault-sbtc)
(define-constant ZEST-MARKET 'SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-4-market)
(define-constant HERMETICA-VAULT 'SP1S1HSFH0SQQGWKB69EYFNY0B1MHRMGXR3J1FH4D.vault-hbtc-v1-1)

(define-map strategy-state uint {
  total-deposited: uint,
  total-shares: uint,
  cap: uint,
  min-deposit: uint,
  enabled: bool
})

(define-map user-positions { user: principal, strategy: uint } {
  shares: uint,
  entry-block: uint
})

(define-data-var total-tvl uint u0)
(define-data-var admin principal tx-sender)

(define-private (get-strategy (id uint))
  (default-to {
    total-deposited: u0,
    total-shares: u0,
    cap: u100000000000,
    min-deposit: u10000,
    enabled: true
  } (map-get? strategy-state id))
)

(define-private (assets-to-shares (amount uint) (strategy uint))
  (let ((s (get-strategy strategy)))
    (if (is-eq (get total-shares s) u0)
      amount
      (/ (* amount (get total-shares s)) (get total-deposited s))
    )
  )
)

(define-private (shares-to-assets (shares uint) (strategy uint))
  (let ((s (get-strategy strategy)))
    (if (is-eq (get total-shares s) u0)
      shares
      (/ (* shares (get total-deposited s)) (get total-shares s))
    )
  )
)

(define-public (deposit (strategy uint) (amount uint))
  (let
    (
      (caller tx-sender)
      (s (get-strategy strategy))
      (shares (assets-to-shares amount strategy))
      (existing (default-to { shares: u0, entry-block: burn-block-height }
        (map-get? user-positions { user: caller, strategy: strategy })))
    )
    (asserts! (get enabled s) ERR-PAUSED)
    (asserts! (> amount u0) ERR-INVALID-AMOUNT)
    (asserts! (>= amount (get min-deposit s)) ERR-BELOW-MINIMUM)
    (asserts! (<= (+ (get total-deposited s) amount) (get cap s)) ERR-STRATEGY-FULL)
    (asserts! (or (is-eq strategy STRATEGY-CARRY) (is-eq strategy STRATEGY-HERMETICA) (is-eq strategy STRATEGY-MIXED)) ERR-INVALID-STRATEGY)
    (asserts! (> shares u0) ERR-INVALID-AMOUNT)

    (try! (contract-call? REAL-SBTC transfer amount caller (as-contract tx-sender) none))

    (if (is-eq strategy STRATEGY-CARRY)
      (try! (as-contract (contract-call? .token-scbtc mint shares caller)))
      (if (is-eq strategy STRATEGY-HERMETICA)
        (try! (as-contract (contract-call? .token-sbbtc mint shares caller)))
        (try! (as-contract (contract-call? .token-sabtc mint shares caller)))
      )
    )

    (map-set strategy-state strategy {
      total-deposited: (+ (get total-deposited s) amount),
      total-shares: (+ (get total-shares s) shares),
      cap: (get cap s),
      min-deposit: (get min-deposit s),
      enabled: (get enabled s)
    })

    (map-set user-positions { user: caller, strategy: strategy } {
      shares: (+ (get shares existing) shares),
      entry-block: burn-block-height
    })

    (var-set total-tvl (+ (var-get total-tvl) amount))

    (print { event: "deposit", user: caller, strategy: strategy, amount: amount, shares: shares })
    (ok { shares: shares, strategy: strategy })
  )
)

(define-public (withdraw (strategy uint) (shares uint))
  (let
    (
      (caller tx-sender)
      (s (get-strategy strategy))
      (assets (shares-to-assets shares strategy))
      (existing (unwrap! (map-get? user-positions { user: caller, strategy: strategy }) ERR-INSUFFICIENT-BALANCE))
    )
    (asserts! (> shares u0) ERR-INVALID-AMOUNT)
    (asserts! (>= (get shares existing) shares) ERR-INSUFFICIENT-BALANCE)

    (if (is-eq strategy STRATEGY-CARRY)
      (try! (contract-call? .token-scbtc burn shares caller))
      (if (is-eq strategy STRATEGY-HERMETICA)
        (try! (contract-call? .token-sbbtc burn shares caller))
        (try! (contract-call? .token-sabtc burn shares caller))
      )
    )

    (try! (as-contract (contract-call? REAL-SBTC transfer assets tx-sender caller none)))

    (map-set strategy-state strategy {
      total-deposited: (- (get total-deposited s) assets),
      total-shares: (- (get total-shares s) shares),
      cap: (get cap s),
      min-deposit: (get min-deposit s),
      enabled: (get enabled s)
    })

    (let ((remaining (- (get shares existing) shares)))
      (if (is-eq remaining u0)
        (map-delete user-positions { user: caller, strategy: strategy })
        (map-set user-positions { user: caller, strategy: strategy }
          (merge existing { shares: remaining }))
      )
    )

    (var-set total-tvl (- (var-get total-tvl) assets))

    (print { event: "withdraw", user: caller, strategy: strategy, shares: shares, assets: assets })
    (ok { assets: assets })
  )
)

(define-public (add-yield (strategy uint) (amount uint))
  (let ((s (get-strategy strategy)))
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-AUTHORIZED)
    (asserts! (> amount u0) ERR-INVALID-AMOUNT)

    (try! (contract-call? REAL-SBTC transfer amount tx-sender (as-contract tx-sender) none))

    (map-set strategy-state strategy (merge s {
      total-deposited: (+ (get total-deposited s) amount)
    }))
    (var-set total-tvl (+ (var-get total-tvl) amount))

    (print { event: "yield-added", strategy: strategy, amount: amount })
    (ok amount)
  )
)

(define-public (set-strategy-config (strategy uint) (cap uint) (min-deposit uint) (enabled bool))
  (let ((s (get-strategy strategy)))
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-AUTHORIZED)
    (map-set strategy-state strategy (merge s {
      cap: cap,
      min-deposit: min-deposit,
      enabled: enabled
    }))
    (ok true)
  )
)

(define-public (set-admin (new-admin principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-AUTHORIZED)
    (var-set admin new-admin)
    (ok true)
  )
)

(define-read-only (get-strategy-info (strategy uint))
  (get-strategy strategy)
)

(define-read-only (get-share-price (strategy uint))
  (let ((s (get-strategy strategy)))
    (if (is-eq (get total-shares s) u0)
      ONE_8
      (/ (* (get total-deposited s) ONE_8) (get total-shares s))
    )
  )
)

(define-read-only (get-user-position (user principal) (strategy uint))
  (match (map-get? user-positions { user: user, strategy: strategy })
    pos (some {
      shares: (get shares pos),
      assets: (shares-to-assets (get shares pos) strategy),
      entry-block: (get entry-block pos)
    })
    none
  )
)

(define-read-only (get-tvl) (var-get total-tvl))

(define-read-only (preview-deposit (strategy uint) (amount uint))
  (assets-to-shares amount strategy)
)

(define-read-only (preview-withdraw (strategy uint) (shares uint))
  (shares-to-assets shares strategy)
)
