"use client";

import { useState, useEffect, useRef } from "react";

export function useTypingIndicator(conversationId: string) {
  const [isTyping, setIsTyping] = useState(false);
  const safetyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!conversationId || conversationId.toLowerCase() === "new") {
      setIsTyping(false);
      return;
    }

    let eventSource: EventSource | null = null;
    let fallbackInterval: NodeJS.Timeout | null = null;
    let isMounted = true;

    // Reset safety timeout
    const resetSafetyTimeout = () => {
      if (safetyTimeoutRef.current) {
        clearTimeout(safetyTimeoutRef.current);
      }
      safetyTimeoutRef.current = setTimeout(() => {
        if (isMounted) {
          setIsTyping(false);
        }
      }, 5000);
    };

    // Initial check
    fetch(`/api/conversations/${conversationId}/typing`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (isMounted && data && typeof data.isTyping === "boolean") {
          setIsTyping(data.isTyping);
          if (data.isTyping) resetSafetyTimeout();
        }
      })
      .catch(() => {});

    // Try Server-Sent Events (SSE)
    if (typeof window !== "undefined" && "EventSource" in window) {
      try {
        eventSource = new EventSource(`/api/conversations/${conversationId}/typing/stream`);

        eventSource.onmessage = (event) => {
          if (!isMounted) return;
          try {
            const data = JSON.parse(event.data);
            if (typeof data.isTyping === "boolean") {
              setIsTyping(data.isTyping);
              if (data.isTyping) {
                resetSafetyTimeout();
              } else if (safetyTimeoutRef.current) {
                clearTimeout(safetyTimeoutRef.current);
              }
            }
          } catch {}
        };

        eventSource.onerror = () => {
          // If SSE encounters an error, close and fall back to lightweight 1.5s polling
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }

          if (!fallbackInterval && isMounted) {
            fallbackInterval = setInterval(async () => {
              if (typeof document !== "undefined" && document.visibilityState === "hidden") {
                return;
              }
              try {
                const res = await fetch(`/api/conversations/${conversationId}/typing`);
                if (res.ok) {
                  const data = await res.json();
                  if (isMounted && typeof data.isTyping === "boolean") {
                    setIsTyping(data.isTyping);
                  }
                }
              } catch {}
            }, 1500);
          }
        };
      } catch (err) {
        console.warn("[useTypingIndicator] SSE init error, using fallback:", err);
      }
    }

    return () => {
      isMounted = false;
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (fallbackInterval) {
        clearInterval(fallbackInterval);
        fallbackInterval = null;
      }
      if (safetyTimeoutRef.current) {
        clearTimeout(safetyTimeoutRef.current);
      }
      setIsTyping(false);
    };
  }, [conversationId]);

  return isTyping;
}

export default useTypingIndicator;
