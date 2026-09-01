"use client";

import { FIREWORK_COLORS } from "@/lib/constants";
import styles from "./ColorPalette.module.css";

interface ColorPaletteProps {
  value: string;
  onChange: (hex: string) => void;
}

export default function ColorPalette({ value, onChange }: ColorPaletteProps) {
  return (
    <div className={styles.row} role="radiogroup" aria-label="いろ">
      {FIREWORK_COLORS.map((c) => {
        const selected = c.hex === value;
        return (
          <button
            key={c.hex}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={c.name}
            className={selected ? `${styles.swatch} ${styles.selected}` : styles.swatch}
            onClick={() => onChange(c.hex)}
          >
            <span
              className={styles.dot}
              style={{ background: c.hex, boxShadow: `0 0 10px ${c.hex}55` }}
            />
          </button>
        );
      })}
    </div>
  );
}
