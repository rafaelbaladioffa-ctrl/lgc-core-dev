import type { CSSProperties } from "react";

export default function Icon({ name, style }: { name: string; style?: CSSProperties }) {
  return (
    <span className="material-symbols-outlined" style={style}>
      {name}
    </span>
  );
}
