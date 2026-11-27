import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
export function useResource(path, dependencies = []) {
  const [data, setData] = useState(null);
  const dataRef = useRef(null);
  const pathRef = useRef(path);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    if (!path) {
      dataRef.current = null;
      pathRef.current = path;
      setData(null);
      setError("");
      setErrorStatus(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const changingPath = pathRef.current !== path;
    pathRef.current = path;
    setLoading(changingPath || dataRef.current === null);
    setError("");
    setErrorStatus(null);
    if (changingPath) {
      dataRef.current = null;
      setData(null);
    }
    api(path, { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted) return;
        dataRef.current = value;
        setData(value);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setError(err.message);
          setErrorStatus(err.status || null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, attempt, ...dependencies]);
  return { data, loading, error, errorStatus, reload, setData };
}
export function useDebounced(value, delay = 250) {
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setCurrent(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return current;
}
