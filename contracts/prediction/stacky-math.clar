(define-constant ONE_8 u100000000)
(define-constant MAX_UINT u340282366920938463463374607431768211455)

(define-read-only (mul-down (a uint) (b uint))
  (/ (* a b) ONE_8)
)

(define-read-only (mul-up (a uint) (b uint))
  (let ((product (* a b)))
    (if (is-eq product u0)
      u0
      (+ u1 (/ (- product u1) ONE_8))
    )
  )
)

(define-read-only (div-down (a uint) (b uint))
  (if (or (is-eq a u0) (is-eq b u0))
    u0
    (/ (* a ONE_8) b)
  )
)

(define-read-only (div-up (a uint) (b uint))
  (if (or (is-eq a u0) (is-eq b u0))
    u0
    (+ u1 (/ (- (* a ONE_8) u1) b))
  )
)

(define-read-only (min (a uint) (b uint))
  (if (<= a b) a b)
)

(define-read-only (max (a uint) (b uint))
  (if (>= a b) a b)
)

(define-read-only (sbtc-to-usd (sbtc-amount uint) (btc-price uint))
  (mul-down sbtc-amount btc-price)
)
