(define-fungible-token scBTC)

(define-constant ERR-NOT-AUTHORIZED (err u1000))
(define-constant ERR-NOT-TOKEN-OWNER (err u1004))

(define-map authorized-minters principal bool)

(define-public (set-minter (minter principal) (enabled bool))
  (begin
    (asserts! (contract-call? .stacky-governance is-owner contract-caller) ERR-NOT-AUTHORIZED)
    (map-set authorized-minters minter enabled)
    (ok true)
  )
)

(define-read-only (is-minter (caller principal))
  (default-to false (map-get? authorized-minters caller))
)

(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-minter contract-caller) ERR-NOT-AUTHORIZED)
    (ft-mint? scBTC amount recipient)
  )
)

(define-public (burn (amount uint) (sender principal))
  (begin
    (asserts! (or (is-eq contract-caller sender) (is-minter contract-caller)) ERR-NOT-AUTHORIZED)
    (ft-burn? scBTC amount sender)
  )
)

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (or (is-eq tx-sender sender) (is-eq contract-caller sender)) ERR-NOT-TOKEN-OWNER)
    (try! (ft-transfer? scBTC amount sender recipient))
    (match memo to-print (print to-print) 0x)
    (ok true)
  )
)

(define-read-only (get-name) (ok "Stacky Carry BTC"))
(define-read-only (get-symbol) (ok "scBTC"))
(define-read-only (get-decimals) (ok u8))
(define-read-only (get-balance (account principal)) (ok (ft-get-balance scBTC account)))
(define-read-only (get-total-supply) (ok (ft-get-supply scBTC)))
(define-read-only (get-token-uri) (ok none))
