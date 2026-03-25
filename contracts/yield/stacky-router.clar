(define-constant ERR-NOT-ADMIN (err u9000))
(define-constant ADMIN tx-sender)

(define-constant SBTC-VAULT 'SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-vault-sbtc)
(define-constant USDC-VAULT 'SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-vault-usdc)
(define-constant STX-VAULT 'SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-vault-stx)
(define-constant SWAP-POOL 'SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.stableswap-pool-aeusdc-usdcx-v-1-1)
(define-constant AEUSDC 'SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc)
(define-constant USDCX 'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx)

(define-public (deposit-carry (sbtc-amount uint) (usdc-to-borrow uint))
  (contract-call? .stacky-carry-v9 deposit SBTC-VAULT USDC-VAULT SWAP-POOL AEUSDC USDCX sbtc-amount usdc-to-borrow))

(define-public (withdraw-carry (shares uint))
  (contract-call? .stacky-carry-v9 withdraw SBTC-VAULT USDC-VAULT SWAP-POOL AEUSDC USDCX shares))

(define-public (deposit-stx-carry (sbtc-amount uint) (usdc-to-borrow uint))
  (contract-call? .stacky-stx-carry-v2 deposit SBTC-VAULT USDC-VAULT SWAP-POOL AEUSDC USDCX sbtc-amount usdc-to-borrow))

(define-public (withdraw-stx-carry (shares uint))
  (contract-call? .stacky-stx-carry-v2 withdraw SBTC-VAULT USDC-VAULT STX-VAULT SWAP-POOL AEUSDC USDCX shares))

(define-public (deposit-hermetica (sbtc-amount uint))
  (contract-call? .stacky-hermetica-v2 deposit sbtc-amount))

(define-public (withdraw-hermetica (shares uint) (express bool))
  (contract-call? .stacky-hermetica-v2 request-withdraw shares express))

(define-public (complete-hermetica (claim-id uint))
  (contract-call? .stacky-hermetica-v2 complete-withdraw claim-id))

(define-public (deposit-combined (sbtc-amount uint) (usdc-to-borrow uint))
  (contract-call? .stacky-combined-v4 deposit SBTC-VAULT USDC-VAULT SWAP-POOL AEUSDC USDCX sbtc-amount usdc-to-borrow))

(define-public (withdraw-combined (shares uint))
  (contract-call? .stacky-combined-v4 withdraw-carry SBTC-VAULT USDC-VAULT SWAP-POOL AEUSDC USDCX shares))

(define-public (withdraw-combined-hermetica (shares uint))
  (contract-call? .stacky-combined-v4 request-hermetica-withdraw shares))
