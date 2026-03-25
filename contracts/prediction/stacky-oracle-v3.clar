
(define-constant ERR-NOT-AUTHORIZED (err u1000))
(define-constant ERR-INVALID-AMOUNT (err u1001))
(define-constant ERR-NEGATIVE-PRICE (err u7001))

(define-constant ONE_8 u100000000)

(define-constant BTC_USD_FEED_ID 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43)

(define-constant MAX-STALENESS u36)

(define-trait pyth-storage-read-trait
  ((read ((buff 32)) (response {
    conf: uint,
    ema-conf: uint,
    ema-price: int,
    expo: int,
    prev-publish-time: uint,
    price: int,
    publish-time: uint
  } uint)))
)

(define-data-var btc-price uint u8500000000000)
(define-data-var last-update-height uint u0)
(define-data-var peg-ratio uint u100000000)

(define-public (set-btc-price (price uint))
  (begin
    (asserts! (contract-call? .stacky-governance-v2 is-authorized contract-caller) ERR-NOT-AUTHORIZED)
    (asserts! (> price u0) ERR-INVALID-AMOUNT)
    (var-set btc-price price)
    (var-set last-update-height burn-block-height)
    (print { event: "price-updated", price: price, source: "manual" })
    (ok true)
  )
)

(define-private (pow10 (n int))
  (if (is-eq n 0) u1
  (if (is-eq n 1) u10
  (if (is-eq n 2) u100
  (if (is-eq n 3) u1000
  (if (is-eq n 4) u10000
  (if (is-eq n 5) u100000
  (if (is-eq n 6) u1000000
  (if (is-eq n 7) u10000000
  (if (is-eq n 8) u100000000
  (if (is-eq n 9) u1000000000
  (if (is-eq n 10) u10000000000
  u1)))))))))))
)

(define-private (normalize-pyth-price (raw-price uint) (expo int))
  (let
    (
      (shift (+ expo 8))
    )
    (if (> shift 0)
      (* raw-price (pow10 shift))
      (if (< shift 0)
        (/ raw-price (pow10 (* shift (- 1))))
        raw-price
      )
    )
  )
)

(define-public (update-price-pyth (pyth-storage <pyth-storage-read-trait>))
  (let (
    (price-data (try! (contract-call? pyth-storage read BTC_USD_FEED_ID)))
    (raw-price (get price price-data))
    (expo (get expo price-data))
  )
    (asserts! (contract-call? .stacky-governance-v2 is-authorized contract-caller) ERR-NOT-AUTHORIZED)
    (asserts! (> raw-price 0) ERR-NEGATIVE-PRICE)
    (let ((normalized (normalize-pyth-price (to-uint raw-price) expo)))
      (asserts! (> normalized u0) ERR-INVALID-AMOUNT)
      (var-set btc-price normalized)
      (var-set last-update-height burn-block-height)
      (print { event: "price-updated", price: normalized, raw: (to-uint raw-price), expo: expo, source: "pyth" })
      (ok normalized)
    )
  )
)

(define-public (set-peg-ratio (ratio uint))
  (begin
    (asserts! (contract-call? .stacky-governance-v2 is-authorized contract-caller) ERR-NOT-AUTHORIZED)
    (asserts! (> ratio u0) ERR-INVALID-AMOUNT)
    (var-set peg-ratio ratio)
    (print { event: "peg-updated", ratio: ratio })
    (ok true)
  )
)

(define-trait dex-price-feed-trait
  ((get-sbtc-btc-ratio () (response uint uint)))
)

(define-trait sbtc-rewards-trait
  ((enroll ((optional principal)) (response bool uint)))
)

(define-public (update-peg-from-dex (dex-feed <dex-price-feed-trait>))
  (let (
    (ratio (try! (contract-call? dex-feed get-sbtc-btc-ratio)))
  )
    (asserts! (contract-call? .stacky-governance-v2 is-authorized contract-caller) ERR-NOT-AUTHORIZED)
    (asserts! (> ratio u0) ERR-INVALID-AMOUNT)
    (var-set peg-ratio ratio)
    (print { event: "peg-updated", ratio: ratio, source: "dex" })
    (ok ratio)
  )
)

(define-public (enroll-in-rewards (rewards-contract <sbtc-rewards-trait>) (reward-recipient (optional principal)))
  (begin
    (asserts! (contract-call? .stacky-governance-v2 is-authorized contract-caller) ERR-NOT-AUTHORIZED)
    (try! (as-contract (contract-call? rewards-contract enroll reward-recipient)))
    (print { event: "enrolled-in-rewards", recipient: reward-recipient })
    (ok true)
  )
)

(define-read-only (get-btc-price) (var-get btc-price))
(define-read-only (get-peg-ratio) (var-get peg-ratio))
(define-read-only (get-last-update-height) (var-get last-update-height))
(define-read-only (is-price-fresh)
  (<= (- burn-block-height (var-get last-update-height)) MAX-STALENESS)
)

(define-read-only (get-btc-price-with-freshness)
  {
    price: (var-get btc-price),
    last-updated: (var-get last-update-height),
    is-fresh: (is-price-fresh)
  }
)
