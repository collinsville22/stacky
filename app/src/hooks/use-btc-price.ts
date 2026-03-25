import { useState, useEffect } from "react";

export function useBtcPrice() {
  const [price, setPrice] = useState(0);
  const [change24h, setChange24h] = useState(0);

  useEffect(() => {
    let mounted = true;

    async function fetchPrice() {
      try {
        const res = await fetch(
          "https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT"
        );
        const data = await res.json();
        if (!mounted) return;
        setPrice(parseFloat(data.lastPrice) || 0);
        setChange24h(parseFloat(data.priceChangePercent) || 0);
      } catch {}
    }

    fetchPrice();
    const interval = setInterval(fetchPrice, 5000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  return { price, change24h };
}
