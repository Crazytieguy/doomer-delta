import { useEffect, useRef, useState, useCallback } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import {
  workerResponseSchema,
  type WorkerNode,
} from "../types/workerMessages";
import { computeProbabilisticFingerprint } from "@/lib/probabilisticFingerprint";

export interface SensitivityResult {
  nodeId: Id<"nodes">;
  sensitivity: number;
}

export interface SensitivityState {
  isLoading: boolean;
  results: SensitivityResult[];
  progress: number;
  total: number;
  error: string | null;
}

export interface MarginalsState {
  isLoading: boolean;
  probabilities: Map<Id<"nodes">, number>;
  error: string | null;
}

const MAX_CACHE_SIZE = 100;

class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value as K;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }
}

const marginalsCache = new LRUCache<string, Map<Id<"nodes">, number>>(MAX_CACHE_SIZE);
const sensitivityCache = new LRUCache<string, SensitivityResult[]>(MAX_CACHE_SIZE);

let sharedWorker: Worker | null = null;

function getSharedWorker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new Worker(
      new URL("../workers/inference.worker.ts", import.meta.url),
      { type: "module" }
    );
  }
  return sharedWorker;
}

export function useInferenceWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pendingMarginalsCacheKey = useRef<string | null>(null);
  const pendingSensitivityCacheKey = useRef<string | null>(null);
  const currentMarginalsRequestId = useRef<string | null>(null);
  const currentSensitivityRequestId = useRef<string | null>(null);

  const [sensitivityState, setSensitivityState] = useState<SensitivityState>({
    isLoading: false,
    results: [],
    progress: 0,
    total: 0,
    error: null,
  });
  const [marginalsState, setMarginalsState] = useState<MarginalsState>({
    isLoading: false,
    probabilities: new Map(),
    error: null,
  });

  useEffect(() => {
    workerRef.current = getSharedWorker();

    const handleMessage = (event: MessageEvent) => {
      try {
        const message = workerResponseSchema.parse(event.data);

        if (message.type === "MARGINALS_RESULT") {
          if (message.requestId !== currentMarginalsRequestId.current) return;

          const probabilities = new Map<Id<"nodes">, number>();
          for (const [nodeId, prob] of Object.entries(message.probabilities)) {
            probabilities.set(nodeId as Id<"nodes">, prob);
          }

          if (pendingMarginalsCacheKey.current) {
            marginalsCache.set(pendingMarginalsCacheKey.current, probabilities);
            pendingMarginalsCacheKey.current = null;
          }

          setMarginalsState({
            isLoading: false,
            probabilities,
            error: null,
          });
        } else if (message.type === "SENSITIVITY_PROGRESS") {
          if (message.requestId !== currentSensitivityRequestId.current) return;

          setSensitivityState((prev) => ({
            ...prev,
            results: [
              ...prev.results,
              { nodeId: message.nodeId, sensitivity: message.sensitivity },
            ],
            progress: message.completed,
            total: message.total,
          }));
        } else if (message.type === "SENSITIVITY_COMPLETE") {
          if (message.requestId !== currentSensitivityRequestId.current) return;

          if (pendingSensitivityCacheKey.current) {
            sensitivityCache.set(pendingSensitivityCacheKey.current, message.sensitivities);
            pendingSensitivityCacheKey.current = null;
          }

          setSensitivityState((prev) => ({
            ...prev,
            isLoading: false,
          }));
        } else if (message.type === "ERROR") {
          if (message.requestId === currentMarginalsRequestId.current) {
            pendingMarginalsCacheKey.current = null;
            setMarginalsState((prev) => ({
              ...prev,
              isLoading: false,
              error: message.error,
            }));
          } else if (message.requestId === currentSensitivityRequestId.current) {
            pendingSensitivityCacheKey.current = null;
            setSensitivityState((prev) => ({
              ...prev,
              isLoading: false,
              error: message.error,
            }));
          }
        }
      } catch (error) {
        console.error("Failed to parse worker message:", error);
      }
    };

    const handleError = (error: ErrorEvent) => {
      pendingMarginalsCacheKey.current = null;
      pendingSensitivityCacheKey.current = null;
      setMarginalsState((prev) => ({
        ...prev,
        isLoading: false,
        error: error.message,
      }));
      setSensitivityState((prev) => ({
        ...prev,
        isLoading: false,
        error: error.message,
      }));
    };

    workerRef.current.addEventListener("message", handleMessage);
    workerRef.current.addEventListener("error", handleError);

    return () => {
      workerRef.current?.removeEventListener("message", handleMessage);
      workerRef.current?.removeEventListener("error", handleError);
    };
  }, []);

  const computeMarginals = useCallback((nodes: WorkerNode[]) => {
    if (!workerRef.current) return;

    const cacheKey = computeProbabilisticFingerprint(nodes);
    const cached = marginalsCache.get(cacheKey);

    if (cached) {
      setMarginalsState({
        isLoading: false,
        probabilities: cached,
        error: null,
      });
      return;
    }

    const requestId = crypto.randomUUID();
    currentMarginalsRequestId.current = requestId;
    pendingMarginalsCacheKey.current = cacheKey;

    setMarginalsState((prev) => ({
      ...prev,
      isLoading: true,
      error: null,
    }));

    workerRef.current.postMessage({
      type: "COMPUTE_MARGINALS",
      requestId,
      nodes,
    });
  }, []);

  const computeSensitivity = useCallback(
    (nodes: WorkerNode[], targetNodeId: Id<"nodes">) => {
      if (!workerRef.current) return;

      const cacheKey = `${computeProbabilisticFingerprint(nodes)}:${targetNodeId}`;
      const cached = sensitivityCache.get(cacheKey);

      if (cached) {
        setSensitivityState({
          isLoading: false,
          results: cached,
          progress: 0,
          total: 0,
          error: null,
        });
        return;
      }

      const requestId = crypto.randomUUID();
      currentSensitivityRequestId.current = requestId;
      pendingSensitivityCacheKey.current = cacheKey;

      setSensitivityState({
        isLoading: true,
        results: [],
        progress: 0,
        total: 0,
        error: null,
      });

      workerRef.current.postMessage({
        type: "COMPUTE_SENSITIVITY",
        requestId,
        nodes,
        targetNodeId,
      });
    },
    []
  );

  return {
    computeMarginals,
    computeSensitivity,
    sensitivityState,
    marginalsState,
  };
}
