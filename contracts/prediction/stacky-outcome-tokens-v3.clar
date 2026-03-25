
(define-constant ERR-NOT-AUTHORIZED (err u1000))
(define-constant ERR-INVALID-AMOUNT (err u1001))
(define-constant ERR-PAUSED (err u1003))
(define-constant ERR-MARKET-NOT-FOUND (err u6001))
(define-constant ERR-MARKET-CLOSED (err u6002))
(define-constant ERR-MARKET-NOT-RESOLVED (err u6003))
(define-constant ERR-MARKET-ALREADY-RESOLVED (err u6004))
(define-constant ERR-MARKET-NOT-EXPIRED (err u6005))
(define-constant ERR-MARKET-NOT-CANCELLED (err u6006))
(define-constant ERR-MARKET-CANCELLED (err u6009))
(define-constant ERR-INSUFFICIENT-BALANCE (err u6011))
(define-constant ERR-TRANSFER-NOT-ALLOWED (err u6020))
(define-constant ERR-NO-WINNING-TOKENS (err u6021))
(define-constant ERR-ALREADY-REDEEMED (err u6022))

(define-constant ONE_8 u100000000)

(define-data-var market-nonce uint u0)

(define-map balances { token-id: uint, owner: principal } uint)

(define-map token-supplies uint uint)

(define-map approved-operators { owner: principal, operator: principal } bool)

(define-map markets uint {
  creator: principal,
  question: (string-ascii 256),
  collateral-locked: uint,
  resolved: bool,
  outcome: bool,
  cancelled: bool,
  market-type: (string-ascii 16),
  target-price: uint,
  start-price: uint,
  resolution-height: uint
})

(define-map redeemed { market-id: uint, user: principal } bool)

(define-private (get-balance-or-zero (token-id uint) (owner principal))
  (default-to u0 (map-get? balances { token-id: token-id, owner: owner }))
)

(define-private (get-supply-or-zero (token-id uint))
  (default-to u0 (map-get? token-supplies token-id))
)

(define-private (yes-token-id (market-id uint))
  (* market-id u2)
)

(define-private (no-token-id (market-id uint))
  (+ (* market-id u2) u1)
)

(define-private (mint-tokens (token-id uint) (amount uint) (recipient principal))
  (begin
    (map-set balances { token-id: token-id, owner: recipient }
      (+ (get-balance-or-zero token-id recipient) amount))
    (map-set token-supplies token-id
      (+ (get-supply-or-zero token-id) amount))
    true
  )
)

(define-private (burn-tokens (token-id uint) (amount uint) (owner principal))
  (let
    (
      (bal (get-balance-or-zero token-id owner))
    )
    (asserts! (>= bal amount) ERR-INSUFFICIENT-BALANCE)
    (map-set balances { token-id: token-id, owner: owner } (- bal amount))
    (map-set token-supplies token-id (- (get-supply-or-zero token-id) amount))
    (ok true)
  )
)
(define-public (create-market
    (question (string-ascii 256))
    (target-price uint)
    (resolution-height uint)
    (market-type (string-ascii 16))
    (start-price uint))
  (let
    (
      (id (var-get market-nonce))
    )
    ;; FIX Bug 6: use governance-v2
    (asserts! (not (contract-call? .stacky-governance-v2 get-paused)) ERR-PAUSED)
    (asserts! (contract-call? .stacky-governance-v2 is-authorized contract-caller) ERR-NOT-AUTHORIZED)

    (map-set markets id {
      creator: tx-sender,
      question: question,
      collateral-locked: u0,
      resolved: false,
      outcome: false,
      cancelled: false,
      market-type: market-type,
      target-price: target-price,
      start-price: start-price,
      resolution-height: resolution-height
    })
    (var-set market-nonce (+ id u1))

    (print {
      event: "market-created",
      id: id,
      question: question,
      market-type: market-type,
      start-price: start-price,
      resolution-height: resolution-height
    })
    (ok id)
  )
)

(define-public (create-updown-market
    (timeframe-label (string-ascii 16))
    (betting-blocks uint))
  (let
    (
      (id (var-get market-nonce))
      ;; FIX Bug 6: use oracle-v2 (not oracle v1)
      (current-price (contract-call? .stacky-oracle-v3 get-btc-price))
    )
    (asserts! (not (contract-call? .stacky-governance-v2 get-paused)) ERR-PAUSED)
    (asserts! (contract-call? .stacky-governance-v2 is-authorized contract-caller) ERR-NOT-AUTHORIZED)
    (asserts! (> current-price u0) ERR-INVALID-AMOUNT)
    (asserts! (> betting-blocks u0) ERR-INVALID-AMOUNT)

    (map-set markets id {
      creator: tx-sender,
      question: timeframe-label,
      collateral-locked: u0,
      resolved: false,
      outcome: false,
      cancelled: false,
      market-type: timeframe-label,
      target-price: current-price,
      start-price: current-price,
      resolution-height: (+ burn-block-height betting-blocks)
    })
    (var-set market-nonce (+ id u1))

    (print {
      event: "updown-created",
      id: id,
      timeframe: timeframe-label,
      start-price: current-price,
      betting-closes: (+ burn-block-height betting-blocks)
    })
    (ok id)
  )
)

(define-public (resolve-updown-market (market-id uint))
  (let
    (
      (market (unwrap! (map-get? markets market-id) ERR-MARKET-NOT-FOUND))
      (price (contract-call? .stacky-oracle-v3 get-btc-price))
      (target (get target-price market))
      (outcome (>= price target))
    )
    (asserts! (not (contract-call? .stacky-governance-v2 get-paused)) ERR-PAUSED)
    (asserts! (contract-call? .stacky-governance-v2 is-authorized contract-caller) ERR-NOT-AUTHORIZED)
    (asserts! (not (get resolved market)) ERR-MARKET-ALREADY-RESOLVED)
    (asserts! (not (get cancelled market)) ERR-MARKET-CANCELLED)

    (map-set markets market-id (merge market {
      resolved: true,
      outcome: outcome
    }))

    (print {
      event: "market-resolved",
      market-id: market-id,
      outcome: outcome,
      price: price,
      target: target
    })
    (ok outcome)
  )
)

(define-public (cancel-market (market-id uint))
  (let
    (
      (market (unwrap! (map-get? markets market-id) ERR-MARKET-NOT-FOUND))
    )
    (asserts! (contract-call? .stacky-governance-v2 is-authorized contract-caller) ERR-NOT-AUTHORIZED)
    (asserts! (not (get resolved market)) ERR-MARKET-ALREADY-RESOLVED)
    (asserts! (not (get cancelled market)) ERR-MARKET-CANCELLED)

    (map-set markets market-id (merge market { cancelled: true }))
    (print { event: "market-cancelled", market-id: market-id })
    (ok true)
  )
)

(define-public (split-collateral (market-id uint) (amount uint))
  (let
    (
      (market (unwrap! (map-get? markets market-id) ERR-MARKET-NOT-FOUND))
      (caller tx-sender)
      (yes-id (yes-token-id market-id))
      (no-id (no-token-id market-id))
    )
    (asserts! (not (get resolved market)) ERR-MARKET-CLOSED)
    (asserts! (not (get cancelled market)) ERR-MARKET-CANCELLED)
    (asserts! (> amount u0) ERR-INVALID-AMOUNT)

    (try! (contract-call? .sbtc-token transfer amount caller (as-contract tx-sender) none))

    (mint-tokens yes-id amount caller)
    (mint-tokens no-id amount caller)

    (map-set markets market-id (merge market {
      collateral-locked: (+ (get collateral-locked market) amount)
    }))

    (print { event: "split", market-id: market-id, user: caller, amount: amount })
    (ok true)
  )
)

(define-public (merge-tokens (market-id uint) (amount uint))
  (let
    (
      (market (unwrap! (map-get? markets market-id) ERR-MARKET-NOT-FOUND))
      (caller tx-sender)
      (yes-id (yes-token-id market-id))
      (no-id (no-token-id market-id))
    )
    (asserts! (not (get resolved market)) ERR-MARKET-CLOSED)
    (asserts! (not (get cancelled market)) ERR-MARKET-CANCELLED)
    (asserts! (> amount u0) ERR-INVALID-AMOUNT)

    (try! (burn-tokens yes-id amount caller))
    (try! (burn-tokens no-id amount caller))

    (try! (as-contract (contract-call? .sbtc-token transfer amount tx-sender caller none)))

    (map-set markets market-id (merge market {
      collateral-locked: (- (get collateral-locked market) amount)
    }))

    (print { event: "merge", market-id: market-id, user: caller, amount: amount })
    (ok true)
  )
)

(define-public (redeem (market-id uint))
  (let
    (
      (market (unwrap! (map-get? markets market-id) ERR-MARKET-NOT-FOUND))
      (caller tx-sender)
      (yes-id (yes-token-id market-id))
      (no-id (no-token-id market-id))
      (outcome (get outcome market))
      (winning-id (if outcome yes-id no-id))
      (winning-bal (get-balance-or-zero winning-id caller))
    )
    (asserts! (get resolved market) ERR-MARKET-NOT-RESOLVED)
    (asserts! (not (get cancelled market)) ERR-MARKET-CANCELLED)
    (asserts! (not (default-to false (map-get? redeemed { market-id: market-id, user: caller }))) ERR-ALREADY-REDEEMED)
    (asserts! (> winning-bal u0) ERR-NO-WINNING-TOKENS)

    (try! (burn-tokens winning-id winning-bal caller))

    (let
      (
        (losing-id (if outcome no-id yes-id))
        (losing-bal (get-balance-or-zero losing-id caller))
      )
      (if (> losing-bal u0)
        (try! (burn-tokens losing-id losing-bal caller))
        true
      )
    )

    (try! (as-contract (contract-call? .sbtc-token transfer winning-bal tx-sender caller none)))

    (map-set redeemed { market-id: market-id, user: caller } true)

    (map-set markets market-id (merge market {
      collateral-locked: (- (get collateral-locked market) winning-bal)
    }))

    (print { event: "redeemed", market-id: market-id, user: caller, amount: winning-bal })
    (ok winning-bal)
  )
)

(define-public (refund-cancelled (market-id uint))
  (let
    (
      (market (unwrap! (map-get? markets market-id) ERR-MARKET-NOT-FOUND))
      (caller tx-sender)
      (yes-id (yes-token-id market-id))
      (no-id (no-token-id market-id))
      (yes-bal (get-balance-or-zero yes-id caller))
      (no-bal (get-balance-or-zero no-id caller))
      ;; Refund = min(yes, no) since each pair represents 1 unit of collateral
      (refund-amount (if (<= yes-bal no-bal) yes-bal no-bal))
    )
    (asserts! (get cancelled market) ERR-MARKET-NOT-CANCELLED)
    (asserts! (not (default-to false (map-get? redeemed { market-id: market-id, user: caller }))) ERR-ALREADY-REDEEMED)
    (asserts! (> refund-amount u0) ERR-INSUFFICIENT-BALANCE)

    ;; Burn equal amounts of YES and NO tokens
    (try! (burn-tokens yes-id refund-amount caller))
    (try! (burn-tokens no-id refund-amount caller))

    ;; Return collateral
    (try! (as-contract (contract-call? .sbtc-token transfer refund-amount tx-sender caller none)))

    (map-set redeemed { market-id: market-id, user: caller } true)

    (map-set markets market-id (merge market {
      collateral-locked: (- (get collateral-locked market) refund-amount)
    }))

    (print { event: "refund-cancelled", market-id: market-id, user: caller, amount: refund-amount })
    (ok refund-amount)
  )
)
(define-public (transfer (token-id uint) (amount uint) (sender principal) (recipient principal))
  (let
    (
      (bal (get-balance-or-zero token-id sender))
    )
    (asserts! (or
      (is-eq tx-sender sender)
      (default-to false (map-get? approved-operators { owner: sender, operator: tx-sender }))
      (default-to false (map-get? approved-operators { owner: sender, operator: contract-caller }))
    ) ERR-TRANSFER-NOT-ALLOWED)
    (asserts! (> amount u0) ERR-INVALID-AMOUNT)
    (asserts! (>= bal amount) ERR-INSUFFICIENT-BALANCE)

    (map-set balances { token-id: token-id, owner: sender } (- bal amount))
    (map-set balances { token-id: token-id, owner: recipient }
      (+ (get-balance-or-zero token-id recipient) amount))

    (print { event: "transfer", token-id: token-id, sender: sender, recipient: recipient, amount: amount })
    (ok true)
  )
)

(define-public (set-approved-operator (operator principal) (approved bool))
  (begin
    (map-set approved-operators { owner: tx-sender, operator: operator } approved)
    (print { event: "operator-approved", owner: tx-sender, operator: operator, approved: approved })
    (ok true)
  )
)
(define-read-only (get-balance (token-id uint) (owner principal))
  (get-balance-or-zero token-id owner)
)

(define-read-only (get-total-supply (token-id uint))
  (get-supply-or-zero token-id)
)

(define-read-only (get-market (market-id uint))
  (map-get? markets market-id)
)

(define-read-only (get-market-count)
  (var-get market-nonce)
)

(define-read-only (get-yes-token-id (market-id uint))
  (yes-token-id market-id)
)

(define-read-only (get-no-token-id (market-id uint))
  (no-token-id market-id)
)

(define-read-only (is-operator-approved (owner principal) (operator principal))
  (default-to false (map-get? approved-operators { owner: owner, operator: operator }))
)

(define-read-only (has-redeemed (market-id uint) (user principal))
  (default-to false (map-get? redeemed { market-id: market-id, user: user }))
)
