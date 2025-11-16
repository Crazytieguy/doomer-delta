import { useEffect, useRef, useState, useCallback } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { workerResponseSchema, type WorkerNode } from "../types/workerMessages";
import { computeProbabilisticFingerprint } from "@/lib/probabilisticFingerprint";

export interface SensitivityState {
  isLoading: boolean;
  results: Map<Id<"nodes">, number>;
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

const marginalsCache = new LRUCache<string, Map<Id<"nodes">, number>>(
  MAX_CACHE_SIZE,
);
const sensitivityCache = new LRUCache<string, Map<Id<"nodes">, number>>(
  MAX_CACHE_SIZE,
);

let sharedWorker: Worker | null = null;
let sharedWorkerReady = false;

function getSharedWorker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new Worker(
      new URL("../workers/inference.worker.ts", import.meta.url),
      { type: "module" },
    );
  }
  return sharedWorker;
}

function isSharedWorkerReady(): boolean {
  return sharedWorkerReady;
}

function setSharedWorkerReady(): void {
  sharedWorkerReady = true;
}

export function useInferenceWorker() {
  const workerRef = useRef<Worker | null>(null);
  const workerReady = useRef(false);
  const messageQueue = useRef<Array<unknown>>([]);
  const pendingMarginalsCacheKey = useRef<string | null>(null);
  const pendingSensitivityCacheKey = useRef<string | null>(null);
  const currentMarginalsRequestId = useRef<string | null>(null);
  const currentSensitivityRequestId = useRef<string | null>(null);

  const [sensitivityState, setSensitivityState] = useState<SensitivityState>({
    isLoading: false,
    results: new Map(),
    error: null,
  });
  const [marginalsState, setMarginalsState] = useState<MarginalsState>({
    isLoading: false,
    probabilities: new Map(),
    error: null,
  });

  useEffect(() => {
    workerRef.current = getSharedWorker();
    workerReady.current = isSharedWorkerReady();

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "WORKER_READY") {
        workerReady.current = true;
        setSharedWorkerReady();
        while (messageQueue.current.length > 0) {
          const queued = messageQueue.current.shift();
          if (queued && workerRef.current) {
            workerRef.current.postMessage(queued);
          }
        }
        return;
      }

      try {
        const message = workerResponseSchema.parse(event.data);

        if (message.type === "MARGINALS_RESULT") {
          if (message.requestId !== currentMarginalsRequestId.current) return;

          if (pendingMarginalsCacheKey.current) {
            marginalsCache.set(
              pendingMarginalsCacheKey.current,
              message.probabilities as Map<Id<"nodes">, number>,
            );
            pendingMarginalsCacheKey.current = null;
          }

          setMarginalsState({
            isLoading: false,
            probabilities: message.probabilities as Map<Id<"nodes">, number>,
            error: null,
          });
        } else if (message.type === "SENSITIVITY_COMPLETE") {
          if (message.requestId !== currentSensitivityRequestId.current) return;

          if (pendingSensitivityCacheKey.current) {
            sensitivityCache.set(
              pendingSensitivityCacheKey.current,
              message.sensitivities as Map<Id<"nodes">, number>,
            );
            pendingSensitivityCacheKey.current = null;
          }

          setSensitivityState({
            isLoading: false,
            results: message.sensitivities as Map<Id<"nodes">, number>,
            error: null,
          });
        } else if (message.type === "ERROR") {
          if (message.requestId === currentMarginalsRequestId.current) {
            pendingMarginalsCacheKey.current = null;
            setMarginalsState((prev) => ({
              ...prev,
              isLoading: false,
              error: message.error,
            }));
          } else if (
            message.requestId === currentSensitivityRequestId.current
          ) {
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

    const message = {
      type: "COMPUTE_MARGINALS",
      requestId,
      nodes,
    };

    if (workerReady.current) {
      workerRef.current.postMessage(message);
    } else {
      messageQueue.current.push(message);
    }
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
          error: null,
        });
        return;
      }

      const requestId = crypto.randomUUID();
      currentSensitivityRequestId.current = requestId;
      pendingSensitivityCacheKey.current = cacheKey;

      setSensitivityState({
        isLoading: true,
        results: new Map(),
        error: null,
      });

      const message = {
        type: "COMPUTE_SENSITIVITY",
        requestId,
        nodes,
        targetNodeId,
      };

      if (workerReady.current) {
        workerRef.current.postMessage(message);
      } else {
        messageQueue.current.push(message);
      }
    },
    [],
  );

  return {
    computeMarginals,
    computeSensitivity,
    sensitivityState,
    marginalsState,
  };
}
