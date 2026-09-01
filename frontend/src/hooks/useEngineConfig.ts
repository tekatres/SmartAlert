// Hook: real-time subscription to the engine thresholds config.
import { useEffect, useState } from "react";
import {
  EngineThresholdConfig,
  ENGINE_CONFIG_DEFAULTS,
  watchEngineConfig,
} from "@/services/alerts";

export function useEngineConfig() {
  const [config, setConfig] = useState<EngineThresholdConfig>(ENGINE_CONFIG_DEFAULTS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = watchEngineConfig((cfg) => {
      setConfig(cfg);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  return { config, loading };
}