import React from "react";

export function useAsyncInspector() {
  const ref = React.useRef<string[]>([]);
  return {
    push: (s: string) => {
      ref.current.push(s);
      if (ref.current.length > 100) ref.current.shift();
    },
    list: () => [...ref.current],
  };
}
