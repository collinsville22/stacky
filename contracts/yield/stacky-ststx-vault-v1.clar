
(define-constant ADMIN tx-sender)
(define-constant STSTX 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token)
(define-constant MIN-DEPOSIT u100000) ;; 0.1 stSTX (6 decimals)

(define-data-var total-ststx uint u0)
(define-data-var total-shares uint u0)
(define-data-var paused bool false)
(define-map user-shares principal uint)

(define-public (deposit (amount uint))
  (let
    (
      (caller tx-sender)
      (ts (var-get total-shares))
      (td (var-get total-ststx))
      (shares (if (is-eq ts u0) amount (/ (* amount ts) td)))
    )
    (asserts! (not (var-get paused)) (err u9001))
    (asserts! (>= amount MIN-DEPOSIT) (err u7002))
    (asserts! (> shares u0) (err u1001))

    ;; Transfer stSTX from user to this contract
    (try! (contract-call? 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token transfer amount caller (as-contract tx-sender) none))

    ;; Mint receipt token to user
    (try! (as-contract (contract-call? .token-sbbtc mint shares caller)))

    ;; Update state
    (var-set total-ststx (+ td amount))
    (var-set total-shares (+ ts shares))
    (map-set user-shares caller (+ (default-to u0 (map-get? user-shares caller)) shares))

    (print { event: "ststx-deposit", user: caller, ststx: amount, shares: shares })
    (ok { shares: shares })
  )
)

(define-public (withdraw (shares uint))
  (let
    (
      (caller tx-sender)
      (user-bal (default-to u0 (map-get? user-shares caller)))
      (ts (var-get total-shares))
      (td (var-get total-ststx))
      (ststx-amount (if (is-eq ts u0) shares (/ (* shares td) ts)))
    )
    (asserts! (> shares u0) (err u1001))
    (asserts! (>= user-bal shares) (err u1002))

    ;; Transfer stSTX from contract to user
    (try! (as-contract (contract-call? 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token transfer ststx-amount tx-sender caller none)))

    ;; Burn receipt token
    (try! (contract-call? .token-sbbtc burn shares caller))

    ;; Update state
    (var-set total-ststx (if (>= td ststx-amount) (- td ststx-amount) u0))
    (var-set total-shares (- ts shares))
    (map-set user-shares caller (- user-bal shares))

    (print { event: "ststx-withdraw", user: caller, ststx: ststx-amount, shares: shares })
    (ok { ststx: ststx-amount })
  )
)

(define-public (emergency-pause)
  (begin (asserts! (is-eq contract-caller ADMIN) (err u9000)) (var-set paused true) (ok true)))
(define-public (emergency-unpause)
  (begin (asserts! (is-eq contract-caller ADMIN) (err u9000)) (var-set paused false) (ok true)))
(define-public (emergency-transfer-ststx (amount uint) (recipient principal))
  (begin (asserts! (is-eq contract-caller ADMIN) (err u9000))
    (as-contract (contract-call? 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token transfer amount tx-sender recipient none))))
(define-public (emergency-transfer-stx (amount uint) (recipient principal))
  (begin (asserts! (is-eq contract-caller ADMIN) (err u9000))
    (as-contract (stx-transfer? amount tx-sender recipient))))

(define-read-only (get-share-price)
  (let ((ts (var-get total-shares)) (td (var-get total-ststx)))
    (if (is-eq ts u0) u1000000 (/ (* td u1000000) ts))))
(define-read-only (get-state)
  { total-ststx: (var-get total-ststx), total-shares: (var-get total-shares), paused: (var-get paused) })
(define-read-only (get-user-shares (user principal)) (default-to u0 (map-get? user-shares user)))
(define-read-only (get-min-deposit) MIN-DEPOSIT)
(define-read-only (get-admin) ADMIN)
