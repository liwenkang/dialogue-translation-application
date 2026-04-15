import { useEffect, useState, useCallback } from "react";

interface ToastMessage {
  id: number;
  text: string;
}

let toastId = 0;
let addToastGlobal: ((text: string) => void) | null = null;

export function showToast(text: string) {
  addToastGlobal?.(text);
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((text: string) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2000);
  }, []);

  useEffect(() => {
    addToastGlobal = addToast;
    return () => {
      addToastGlobal = null;
    };
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-800 text-sm px-4 py-2 rounded-lg shadow-lg animate-fade-in"
        >
          {toast.text}
        </div>
      ))}
    </div>
  );
}
