
(define-constant ADMIN tx-sender)
(define-data-var total-sbtc uint u0)
(define-data-var total-shares uint u0)
(define-data-var total-usdc-borrowed uint u0)
(define-data-var total-gusdc uint u0)
(define-data-var paused bool false)
(define-map user-shares principal uint)

(define-public (deposit (sbtc-amount uint) (usdc-to-borrow uint) (price-feed (buff 8192)))
  (let
    (
      (caller tx-sender)
      (ts (var-get total-shares))
      (td (var-get total-sbtc))
      (shares (if (is-eq ts u0) sbtc-amount (/ (* sbtc-amount ts) td)))
    )
    (asserts! (not (var-get paused)) (err u9001))
    (asserts! (>= sbtc-amount u100000) (err u7002))
    (asserts! (> shares u0) (err u1001))
    (asserts! (> usdc-to-borrow u0) (err u1001))

    ;; Step 1: Transfer sBTC from user to contract
    (match (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token transfer sbtc-amount caller (as-contract tx-sender) none)
      s1-ok
      ;; Step 2: Supply sBTC as collateral on Zest v2
      (match (as-contract (contract-call? 'SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-4-market supply-collateral-add
              'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
              sbtc-amount u0 (some (unwrap-panic (as-max-len? (list price-feed) u3)))))
        s2-ok
        ;; Step 3: Borrow USDC from Zest v2
        (let ((s3-ok (try! (as-contract (contract-call? 'SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-4-market borrow
                'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx
                usdc-to-borrow none (some (unwrap-panic (as-max-len? (list price-feed) u3))))))))
          ;; Step 4: Swap USDC -> aeUSDC via Bitflow
          (match (as-contract (contract-call? 'SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.stableswap-swap-helper-v-1-4 swap-helper-a usdc-to-borrow u0
              { a: 'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx,
                b: 'SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc }
              { a: 'SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.stableswap-pool-aeusdc-usdcx-v-1-1 }))
            aeusdc-amount
            ;; Step 5: Deposit aeUSDC into Granite (simple 2-arg call!)
            (match (as-contract (contract-call? 'SP26NGV9AFZBX7XBDBS2C7EC7FCPSAV9PKREQNMVS.liquidity-provider-v1 deposit aeusdc-amount tx-sender))
              s5-ok
              ;; Step 6: Mint receipt shares
              (match (as-contract (contract-call? .token-sabtc mint shares caller))
                s6-ok
                (begin
                  (var-set total-sbtc (+ td sbtc-amount))
                  (var-set total-shares (+ ts shares))
                  (var-set total-usdc-borrowed (+ (var-get total-usdc-borrowed) usdc-to-borrow))
                  (var-set total-gusdc (+ (var-get total-gusdc) aeusdc-amount))
                  (map-set user-shares caller (+ (default-to u0 (map-get? user-shares caller)) shares))
                  (ok { shares: shares, aeusdc-earning: aeusdc-amount }))
                s6-err (err u8006))
              s5-err (err u8005))
            s4-err (err u8004))
          )
        s2-err (err u8002))
      s1-err (err u8001))
  )
)

(define-public (withdraw (shares uint) (price-feed (buff 8192)))
  (let
    (
      (caller tx-sender)
      (user-bal (default-to u0 (map-get? user-shares caller)))
      (ts (var-get total-shares))
      (td (var-get total-sbtc))
      (sbtc-amount (if (is-eq ts u0) shares (/ (* shares td) ts)))
      (usdc-to-repay (/ (* shares (var-get total-usdc-borrowed)) ts))
    )
    (asserts! (> shares u0) (err u1001))
    (asserts! (>= user-bal shares) (err u1002))

    ;; Step 1: Redeem ALL gusdc from Granite (query actual balance)
    ;; Step 1: Get gusdc balance and redeem ALL from Granite
    (let ((gusdc-balance (unwrap-panic (contract-call? 'SP35E2BBMDT2Y1HB0NTK139YBGYV3PAPK3WA8BRNA.state-v1 get-balance (as-contract tx-sender)))))
    (try! (as-contract (contract-call? 'SP26NGV9AFZBX7XBDBS2C7EC7FCPSAV9PKREQNMVS.liquidity-provider-v1 redeem gusdc-balance tx-sender)))
    ;; Step 2: Get actual aeUSDC balance and swap ALL to USDC via Bitflow
    (let ((aeusdc-balance (unwrap-panic (contract-call? 'SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc get-balance (as-contract tx-sender)))))
    (let ((usdc-got (try! (as-contract (contract-call? 'SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.stableswap-swap-helper-v-1-4 swap-helper-a aeusdc-balance u0
          { a: 'SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc,
            b: 'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx }
          { a: 'SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.stableswap-pool-aeusdc-usdcx-v-1-1 })))))
    ;; Step 3: Cover slippage gap from user USDCx
    (let ((debt-estimate (+ usdc-to-repay u50000)))
    (let ((gap (if (> debt-estimate usdc-got) (- debt-estimate usdc-got) u0)))
    (if (> gap u0)
      (try! (contract-call? 'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx transfer gap caller (as-contract tx-sender) none))
      true)
    ;; Step 4: Repay with ALL USDCx
    (let ((total-usdc (unwrap-panic (contract-call? 'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx get-balance (as-contract tx-sender)))))
    (try! (as-contract (contract-call? 'SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-4-market repay
            'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx total-usdc none)))
    ;; Step 5: Remove sBTC collateral
    (let ((sbtc-ret (try! (as-contract (contract-call? 'SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-4-market collateral-remove-redeem
            'SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-vault-sbtc
            (- sbtc-amount u100) u0 (some caller)
            (some (unwrap-panic (as-max-len? (list price-feed) u3))))))))
    ;; Step 6: Burn shares + update state
    (try! (contract-call? .token-sabtc burn shares caller))
    (var-set total-sbtc (if (>= td sbtc-ret) (- td sbtc-ret) u0))
    (var-set total-shares (- ts shares))
    (var-set total-usdc-borrowed (if (>= (var-get total-usdc-borrowed) usdc-to-repay) (- (var-get total-usdc-borrowed) usdc-to-repay) u0))
    (var-set total-gusdc u0)
    (map-set user-shares caller (- user-bal shares))
    (ok { sbtc: sbtc-ret })))))))
  ))
)

(define-public (emergency-pause)
  (begin (asserts! (is-eq contract-caller ADMIN) (err u9000)) (var-set paused true) (ok true)))
(define-public (emergency-unpause)
  (begin (asserts! (is-eq contract-caller ADMIN) (err u9000)) (var-set paused false) (ok true)))
(define-public (emergency-transfer-sbtc (amount uint) (recipient principal))
  (begin (asserts! (is-eq contract-caller ADMIN) (err u9000))
    (as-contract (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token transfer amount tx-sender recipient none))))
(define-public (emergency-transfer-aeusdc (amount uint) (recipient principal))
  (begin (asserts! (is-eq contract-caller ADMIN) (err u9000))
    (as-contract (contract-call? 'SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc transfer amount tx-sender recipient none))))
(define-public (emergency-transfer-usdcx (amount uint) (recipient principal))
  (begin (asserts! (is-eq contract-caller ADMIN) (err u9000))
    (as-contract (contract-call? 'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx transfer amount tx-sender recipient none))))
(define-public (emergency-transfer-stx (amount uint) (recipient principal))
  (begin (asserts! (is-eq contract-caller ADMIN) (err u9000))
    (as-contract (stx-transfer? amount tx-sender recipient))))
(define-public (emergency-recover-collateral (amount uint) (price-feed (buff 8192)))
  (begin (asserts! (is-eq contract-caller ADMIN) (err u9000))
    (as-contract (contract-call? 'SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-4-market collateral-remove-redeem
        'SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-vault-sbtc amount u0 (some ADMIN)
        (some (unwrap-panic (as-max-len? (list price-feed) u3)))))))
(define-public (emergency-repay-usdc (amount uint))
  (begin (asserts! (is-eq contract-caller ADMIN) (err u9000))
    (as-contract (contract-call? 'SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-4-market repay
        'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx amount none))))
(define-public (emergency-granite-redeem (shares uint))
  (begin (asserts! (is-eq contract-caller ADMIN) (err u9000))
    (as-contract (contract-call? 'SP26NGV9AFZBX7XBDBS2C7EC7FCPSAV9PKREQNMVS.liquidity-provider-v1 redeem shares tx-sender))))
(define-public (emergency-swap-aeusdc (amount uint))
  (begin (asserts! (is-eq contract-caller ADMIN) (err u9000))
    (as-contract (contract-call? 'SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.stableswap-swap-helper-v-1-4 swap-helper-a amount u0
        { a: 'SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc,
          b: 'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx }
        { a: 'SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.stableswap-pool-aeusdc-usdcx-v-1-1 }))))

(define-read-only (get-share-price)
  (let ((ts (var-get total-shares)) (td (var-get total-sbtc)))
    (if (is-eq ts u0) u100000000 (/ (* td u100000000) ts))))
(define-read-only (get-state)
  { total-sbtc: (var-get total-sbtc), total-shares: (var-get total-shares),
    total-usdc-borrowed: (var-get total-usdc-borrowed),
    total-gusdc: (var-get total-gusdc), paused: (var-get paused) })
(define-read-only (get-user-shares (user principal)) (default-to u0 (map-get? user-shares user)))
(define-read-only (get-min-deposit) u100000)
(define-read-only (get-admin) ADMIN)
