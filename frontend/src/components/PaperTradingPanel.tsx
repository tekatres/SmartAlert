import { TradingSignalDoc } from "@/types";
import { BinanceFuturesSimulator } from "@/components/BinanceFuturesSimulator";

export function PaperTradingPanel({ signals }: { signals: TradingSignalDoc[] }) {
  return <BinanceFuturesSimulator signals={signals} />;
}
