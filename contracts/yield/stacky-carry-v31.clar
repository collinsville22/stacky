(use-trait zv2-ft 'SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.ft-trait.ft-trait)
(use-trait bf-ft 'SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.sip-010-trait-ft-standard-v-1-1.sip-010-trait)
(use-trait bf-pool 'SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.stableswap-pool-trait-v-1-4.stableswap-pool-trait)
(use-trait zv1-rt 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.redeemeable-trait-v1-2.redeemeable-trait)
(use-trait zv1-ft 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.ft-trait.ft-trait)
(use-trait zv1-inc 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.incentives-trait-v2-1.incentives-trait)

(define-constant ADMIN tx-sender)
(define-data-var total-sbtc uint u0)
(define-data-var total-shares uint u0)
(define-data-var total-usdc-borrowed uint u0)
(define-data-var total-aeusdc-supplied uint u0)
(define-data-var paused bool false)
(define-map user-shares principal uint)

(define-public (deposit
    (sbtc-ft <zv2-ft>)
    (usdc-ft <zv2-ft>)
    (bf-token-a <bf-ft>)
    (bf-token-b <bf-ft>)
    (bf-pool-a <bf-pool>)
    (v1-lp <zv1-rt>)
    (v1-asset <zv1-ft>)
    (v1-incentives <zv1-inc>)
    (sbtc-amount uint)
    (usdc-to-borrow uint)
    (price-feed (buff 8192)))
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

    ;; Step 1: Transfer sBTC from user to this contract
    (match (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token transfer sbtc-amount caller (as-contract tx-sender) none)
      s1-ok
      ;; Step 2: Supply sBTC as collateral to Zest v2
      (match (as-contract (contract-call? 'SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-4-market supply-collateral-add sbtc-ft sbtc-amount u0 (some (unwrap-panic (as-max-len? (list price-feed) u3)))))
        s2-ok
        ;; Step 3: Borrow USDC from Zest v2 (try! to surface actual Zest error)
        (let ((s3-ok (try! (as-contract (contract-call? 'SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-4-market borrow usdc-ft usdc-to-borrow none (some (unwrap-panic (as-max-len? (list price-feed) u3))))))))
          ;; Step 4: Swap ALL USDC to aeUSDC via Bitflow
          (match (as-contract (contract-call? 'SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.stableswap-swap-helper-v-1-4 swap-helper-a usdc-to-borrow u0
              { a: bf-token-b, b: bf-token-a }
              { a: bf-pool-a }))
            aeusdc-amount
            ;; Step 5: Supply aeUSDC to Zest v1
            (match (as-contract (contract-call? 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.borrow-helper-v2-1-7 supply
                v1-lp 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.pool-0-reserve v1-asset aeusdc-amount tx-sender none v1-incentives))
              s5-ok
              ;; Step 6: Mint shares + update state
              (match (as-contract (contract-call? .token-scbtc mint shares caller))
                s6-ok
                (begin
                  (var-set total-sbtc (+ td sbtc-amount))
                  (var-set total-shares (+ ts shares))
                  (var-set total-usdc-borrowed (+ (var-get total-usdc-borrowed) usdc-to-borrow))
                  (var-set total-aeusdc-supplied (+ (var-get total-aeusdc-supplied) aeusdc-amount))
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

(define-public (withdraw
    (sbtc-ft <zv2-ft>)
    (usdc-ft <zv2-ft>)
    (bf-token-a <bf-ft>)
    (bf-token-b <bf-ft>)
    (bf-pool-a <bf-pool>)
    (v1-lp <zv1-rt>)
    (v1-asset <zv1-ft>)
    (v1-incentives <zv1-inc>)
    (shares uint)
    (price-feed (buff 8192)))
  (let
    (
      (caller tx-sender)
      (user-bal (default-to u0 (map-get? user-shares caller)))
      (ts (var-get total-shares))
      (td (var-get total-sbtc))
      (sbtc-amount (if (is-eq ts u0) shares (/ (* shares td) ts)))
      (aeusdc-to-withdraw (/ (* shares (var-get total-aeusdc-supplied)) ts))
      (usdc-to-repay (/ (* shares (var-get total-usdc-borrowed)) ts))
    )
    (asserts! (> shares u0) (err u1001))
    (asserts! (>= user-bal shares) (err u1002))

    ;; Withdraw ALL aeUSDC from Zest v1 (including yield) to cover slippage
    (try! (as-contract (contract-call? 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.borrow-helper-v2-1-7 withdraw
        v1-lp 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.pool-0-reserve v1-asset
        'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.aeusdc-oracle-v1-0
        u340282366920938463463374607431768211455 tx-sender
        (list
          { asset: 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token, lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zststx-v2-0, oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 }
          { asset: 'SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc, lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zaeusdc-v2-0, oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.aeusdc-oracle-v1-0 }
          { asset: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.wstx, lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zwstx-v2-0, oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 }
          { asset: 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.arkadiko-token, lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zdiko-v2-0, oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.diko-oracle-v1-1 }
          { asset: 'SPN5AKG35QZSK2M8GAMR4AFX45659RJHDW353HSG.usdh-token-v1, lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zusdh-v2-0, oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.usdh-oracle-v1-0 }
          { asset: 'SP2XD7417HGPRTREMKF748VNEQPDRR0RMANB7X1NK.token-susdt, lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zsusdt-v2-0, oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.susdt-oracle-v1-0 }
          { asset: 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.usda-token, lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zusda-v2-0, oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.usda-oracle-v1-1 }
          { asset: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token, lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zsbtc-v2-0, oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 }
          { asset: 'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-alex, lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zalex-v2-0, oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.alex-oracle-v1-1 }
          { asset: 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststxbtc-token-v2, lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zststxbtc-v2_v2-0, oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 })
        v1-incentives none)))
    ;; Get actual aeUSDC balance (includes yield earned)
    (let ((aeusdc-balance (unwrap-panic (contract-call? 'SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc get-balance (as-contract tx-sender)))))
    (let ((usdc-got (try! (as-contract (contract-call? 'SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.stableswap-swap-helper-v-1-4 swap-helper-a aeusdc-balance u0
          { a: bf-token-a, b: bf-token-b }
          { a: bf-pool-a })))))
      ;; Cover slippage gap: pull extra USDCx from user (tx-sender = user here, NOT as-contract)
      ;; Dynamic gap: exact shortfall + tiny fixed buffer for interest
      (let ((debt-estimate (+ usdc-to-repay u50000)))
      (let ((gap (if (> debt-estimate usdc-got) (- debt-estimate usdc-got) u0)))
      (if (> gap u0)
        (try! (contract-call? 'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx transfer gap caller (as-contract tx-sender) none))
        true)
      ;; Repay with ALL USDCx in contract (swap output + gap top-up)
      (let ((total-usdc (unwrap-panic (contract-call? 'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx get-balance (as-contract tx-sender)))))
      (try! (as-contract (contract-call? 'SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-4-market repay usdc-ft total-usdc none))))
      ;; Fix #1: hardcode v0-vault-sbtc (collateral-remove-redeem needs VAULT token, not underlying)
      ;; Fix #2: use MAX_UINT for amount (Zest removes ALL collateral, returns actual sBTC)
      (let ((sbtc-ret (try! (as-contract (contract-call? 'SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-4-market collateral-remove-redeem
              'SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-vault-sbtc
              (- sbtc-amount u100)
              u0 (some caller) (some (unwrap-panic (as-max-len? (list price-feed) u3))))))))
        (try! (contract-call? .token-scbtc burn shares caller))
        ;; Use sbtc-ret (actual sBTC returned) for state update
        (var-set total-sbtc (if (>= td sbtc-ret) (- td sbtc-ret) u0))
        (var-set total-shares (- ts shares))
        (var-set total-usdc-borrowed (if (>= (var-get total-usdc-borrowed) usdc-to-repay) (- (var-get total-usdc-borrowed) usdc-to-repay) u0))
        (var-set total-aeusdc-supplied (if (>= (var-get total-aeusdc-supplied) aeusdc-to-withdraw) (- (var-get total-aeusdc-supplied) aeusdc-to-withdraw) u0))
        (map-set user-shares caller (- user-bal shares))
        (ok { sbtc: sbtc-ret, usdc-profit: u0 })))))))
)

(define-public (emergency-pause)
  (begin (asserts! (is-eq contract-caller ADMIN) (err u9000)) (var-set paused true) (ok true)))
(define-public (emergency-unpause)
  (begin (asserts! (is-eq contract-caller ADMIN) (err u9000)) (var-set paused false) (ok true)))

(define-public (emergency-transfer-sbtc (amount uint) (recipient principal))
  (begin (asserts! (is-eq contract-caller ADMIN) (err u9000))
    (as-contract (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token transfer amount tx-sender recipient none))))

(define-public (emergency-transfer-ft (ft <bf-ft>) (amount uint) (recipient principal))
  (begin (asserts! (is-eq contract-caller ADMIN) (err u9000))
    (as-contract (contract-call? ft transfer amount tx-sender recipient none))))

(define-public (emergency-recover-collateral (sbtc-ft <zv2-ft>) (amount uint) (price-feed (buff 8192)))
  (begin (asserts! (is-eq contract-caller ADMIN) (err u9000))
    (as-contract (contract-call? 'SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-4-market collateral-remove-redeem sbtc-ft amount u0 (some ADMIN) (some (unwrap-panic (as-max-len? (list price-feed) u3)))))))

(define-public (emergency-repay-debt (usdc-ft <zv2-ft>) (amount uint))
  (begin (asserts! (is-eq contract-caller ADMIN) (err u9000))
    (as-contract (contract-call? 'SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-4-market repay usdc-ft amount none))))

(define-public (emergency-v1-withdraw (v1-lp <zv1-rt>) (v1-asset <zv1-ft>) (v1-incentives <zv1-inc>) (amount uint))
  (begin (asserts! (is-eq contract-caller ADMIN) (err u9000))
    (as-contract (contract-call? 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.borrow-helper-v2-1-7 withdraw
        v1-lp 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.pool-0-reserve v1-asset
        'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.aeusdc-oracle-v1-0
        amount tx-sender
        (list
          { asset: 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token, lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zststx-v2-0, oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 }
          { asset: 'SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc, lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zaeusdc-v2-0, oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.aeusdc-oracle-v1-0 }
          { asset: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.wstx, lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zwstx-v2-0, oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 }
          { asset: 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.arkadiko-token, lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zdiko-v2-0, oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.diko-oracle-v1-1 }
          { asset: 'SPN5AKG35QZSK2M8GAMR4AFX45659RJHDW353HSG.usdh-token-v1, lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zusdh-v2-0, oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.usdh-oracle-v1-0 }
          { asset: 'SP2XD7417HGPRTREMKF748VNEQPDRR0RMANB7X1NK.token-susdt, lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zsusdt-v2-0, oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.susdt-oracle-v1-0 }
          { asset: 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.usda-token, lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zusda-v2-0, oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.usda-oracle-v1-1 }
          { asset: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token, lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zsbtc-v2-0, oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 }
          { asset: 'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-alex, lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zalex-v2-0, oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.alex-oracle-v1-1 }
          { asset: 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststxbtc-token-v2, lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zststxbtc-v2_v2-0, oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 })
        v1-incentives none))))

(define-public (emergency-swap-aeusdc (bf-token-a <bf-ft>) (bf-token-b <bf-ft>) (bf-pool-a <bf-pool>) (amount uint))
  (begin (asserts! (is-eq contract-caller ADMIN) (err u9000))
    (as-contract (contract-call? 'SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.stableswap-swap-helper-v-1-4 swap-helper-a amount u0
        { a: bf-token-a, b: bf-token-b }
        { a: bf-pool-a }))))

(define-read-only (get-share-price)
  (let ((ts (var-get total-shares)) (td (var-get total-sbtc)))
    (if (is-eq ts u0) u100000000 (/ (* td u100000000) ts))))
(define-read-only (get-state)
  { total-sbtc: (var-get total-sbtc), total-shares: (var-get total-shares),
    total-usdc-borrowed: (var-get total-usdc-borrowed),
    total-aeusdc-earning: (var-get total-aeusdc-supplied), paused: (var-get paused) })
(define-read-only (get-user-shares (user principal)) (default-to u0 (map-get? user-shares user)))
(define-read-only (get-min-deposit) u100000)
(define-read-only (get-admin) ADMIN)
