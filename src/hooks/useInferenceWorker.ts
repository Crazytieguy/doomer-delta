import { useEffect, useRef, useState, useCallback } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { workerResponseSchema, type WorkerNode } from "../types/workerMessages";
import { computeProbabilisticFingerprint } from "@/lib/probabilisticFingerprint";

export interface MarginalsState {
  isLoading: boolean;
  probabilities: Map<Id<"nodes">, number>;
  error: string | null;
  _updateCount: number;
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

let sharedWorker: Worker | null = null;
let sharedWorkerReady = false;

type InterventionQueueItem = {
  message: unknown;
  cacheKey: string;
  requestId: string;
};
let interventionQueue: InterventionQueueItem[] = [];
let processingInterventionCacheKey: string | null = null;

type CacheUpdateSubscriber = () => void;
const cacheUpdateSubscribers = new Set<CacheUpdateSubscriber>();

function notifyCacheUpdate(): void {
  for (const subscriber of cacheUpdateSubscribers) {
    subscriber();
  }
}

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

function processNextIntervention(): void {
  if (interventionQueue.length === 0 || processingInterventionCacheKey !== null || !sharedWorkerReady) {
    return;
  }
  const next = interventionQueue.shift()!;
  processingInterventionCacheKey = next.cacheKey;
  sharedWorker?.postMessage(next.message);
}

function onInterventionComplete(): void {
  processingInterventionCacheKey = null;
  processNextIntervention();
}

type PendingRequest =
  | { type: "baseline"; cacheKey: string }
  | { type: "intervention"; cacheKey: string };

export function useInferenceWorker() {
  const workerRef = useRef<Worker | null>(null);
  const workerReady = useRef(false);
  const messageQueue = useRef<Array<unknown>>([]);
  const pendingRequests = useRef<Map<string, PendingRequest>>(new Map());

  const [marginalsState, setMarginalsState] = useState<MarginalsState>({
    isLoading: false,
    probabilities: new Map(),
    error: null,
    _updateCount: 0,
  });

  useEffect(() => {
    const subscriber = () => {
      setMarginalsState((prev) => ({ ...prev, _updateCount: prev._updateCount + 1 }));
    };
    cacheUpdateSubscribers.add(subscriber);
    return () => {
      cacheUpdateSubscribers.delete(subscriber);
    };
  }, []);

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
        processNextIntervention();
        return;
      }

      try {
        const message = workerResponseSchema.parse(event.data);

        if (message.type === "MARGINALS_RESULT") {
          const pending = pendingRequests.current.get(message.requestId);
          if (!pending) return;

          if (pending.type === "baseline" && message.probabilities) {
            marginalsCache.set(
              pending.cacheKey,
              message.probabilities as Map<Id<"nodes">, number>,
            );
            setMarginalsState((prev) => ({
              isLoading: false,
              probabilities: message.probabilities as Map<Id<"nodes">, number>,
              error: null,
              _updateCount: prev._updateCount + 1,
            }));
          } else if (pending.type === "intervention" && message.interventionResult) {
            marginalsCache.set(
              `${pending.cacheKey}:true`,
              message.interventionResult.trueCase as Map<Id<"nodes">, number>,
            );
            marginalsCache.set(
              `${pending.cacheKey}:false`,
              message.interventionResult.falseCase as Map<Id<"nodes">, number>,
            );
            notifyCacheUpdate();
            onInterventionComplete();
          }

          pendingRequests.current.delete(message.requestId);
        } else if (message.type === "ERROR") {
          const pending = pendingRequests.current.get(message.requestId);
          if (pending) {
            pendingRequests.current.delete(message.requestId);
            if (pending.type === "intervention") {
              onInterventionComplete();
            }
            setMarginalsState((prev) => ({
              ...prev,
              isLoading: false,
              error: message.error,
              _updateCount: prev._updateCount + 1,
            }));
          }
        }
      } catch (error) {
        console.error("Failed to parse worker message:", error);
      }
    };

    const handleError = (error: ErrorEvent) => {
      pendingRequests.current.clear();
      interventionQueue = [];
      processingInterventionCacheKey = null;
      setMarginalsState((prev) => ({
        ...prev,
        isLoading: false,
        error: error.message,
        _updateCount: prev._updateCount + 1,
      }));
    };

    workerRef.current.addEventListener("message", handleMessage);
    workerRef.current.addEventListener("error", handleError);

    return () => {
      workerRef.current?.removeEventListener("message", handleMessage);
      workerRef.current?.removeEventListener("error", handleError);
    };
  }, []);

  const computeMarginals = useCallback(
    (nodes: WorkerNode[], interventionNodeId?: Id<"nodes">) => {
      if (!workerRef.current) return;

      const fingerprint = computeProbabilisticFingerprint(nodes);

      if (interventionNodeId) {
        const cacheKey = `${fingerprint}:${interventionNodeId}`;
        const trueCacheKey = `${cacheKey}:true`;
        const falseCacheKey = `${cacheKey}:false`;

        const cachedTrue = marginalsCache.get(trueCacheKey);
        const cachedFalse = marginalsCache.get(falseCacheKey);

        if (cachedTrue && cachedFalse) {
          return;
        }

        const alreadyQueued = interventionQueue.some(
          (item) => item.cacheKey === cacheKey,
        );
        const alreadyProcessing = processingInterventionCacheKey === cacheKey;
        if (alreadyQueued || alreadyProcessing) {
          return;
        }

        const requestId = crypto.randomUUID();
        pendingRequests.current.set(requestId, {
          type: "intervention",
          cacheKey,
        });

        const message = {
          type: "COMPUTE_MARGINALS",
          requestId,
          nodes,
          interventionNodeId,
        };

        interventionQueue.push({
          message,
          cacheKey,
          requestId,
        });
        processNextIntervention();
      } else {
        const cacheKey = `${fingerprint}:null`;
        const cached = marginalsCache.get(cacheKey);

        if (cached) {
          setMarginalsState((prev) => ({
            isLoading: false,
            probabilities: cached,
            error: null,
            _updateCount: prev._updateCount + 1,
          }));
          return;
        }

        const requestId = crypto.randomUUID();
        pendingRequests.current.set(requestId, { type: "baseline", cacheKey });

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
      }
    },
    [],
  );

  const getCachedMarginals = useCallback(
    (nodes: WorkerNode[], interventionNodeId?: Id<"nodes">, value?: boolean) => {
      const fingerprint = computeProbabilisticFingerprint(nodes);
      let cacheKey: string;

      if (interventionNodeId !== undefined && value !== undefined) {
        cacheKey = `${fingerprint}:${interventionNodeId}:${value}`;
      } else {
        cacheKey = `${fingerprint}:null`;
      }

      return marginalsCache.get(cacheKey);
    },
    [],
  );

  return {
    computeMarginals,
    getCachedMarginals,
    marginalsState,
  };
}
