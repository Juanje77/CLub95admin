import { formatARS } from "../domain/money";

/**
 * Barras horizontales de UNA serie (sin leyenda: el título nombra lo que se grafica). Barras finas con el extremo redondeado,
 * valor al final de la barra en tinta de texto, y `title` como tooltip al pasar el mouse. Siempre hay una tabla alternativa al lado.
 */
export interface BarItem {
  label: string;
  value: number;
  /** Texto del valor; por defecto pesos. */
  text?: string;
  hint?: string;
}

export function HBars({ items, ariaLabel, format = formatARS }: { items: BarItem[]; ariaLabel: string; format?: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="hbars" role="img" aria-label={ariaLabel}>
      {items.map((i) => (
        <div className="hb" key={i.label} title={`${i.label}: ${i.text ?? format(i.value)}${i.hint ? ` · ${i.hint}` : ""}`}>
          <span className="lab">{i.label}</span>
          <span className="track">
            {i.value > 0 && <span className="bar" style={{ width: `${Math.max(1, (i.value / max) * 100)}%` }} />}
            <span className="val">{i.text ?? format(i.value)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Barras con signo desde una línea en cero: azul si es positivo, rojo si es negativo, con el signo siempre escrito (nunca solo color).
 * El cero se calcula con el mayor valor negativo y el mayor positivo, así ninguna barra desborda; el valor va en su propia columna.
 */
export function DivergingBars({ items, ariaLabel }: { items: BarItem[]; ariaLabel: string }) {
  const negMax = Math.max(0, ...items.map((i) => (i.value < 0 ? -i.value : 0)));
  const posMax = Math.max(0, ...items.map((i) => (i.value > 0 ? i.value : 0)));
  const total = Math.max(1, negMax + posMax);
  const zero = (negMax / total) * 100;
  return (
    <div className="hbars" role="img" aria-label={ariaLabel}>
      {items.map((i) => {
        const w = (Math.abs(i.value) / total) * 100;
        const sign = i.value > 0 ? "+" : i.value < 0 ? "−" : "";
        const text = `${sign}${formatARS(Math.abs(i.value))}`;
        return (
          <div className="hb dvrow" key={i.label} title={`${i.label}: ${text}`}>
            <span className="lab">{i.label}</span>
            <span className="dv">
              <span className="zero" style={{ left: `${zero}%` }} />
              {i.value > 0 && <span className="bar pos" style={{ left: `${zero}%`, width: `${w}%` }} />}
              {i.value < 0 && <span className="bar neg" style={{ left: `${zero - w}%`, width: `${w}%` }} />}
            </span>
            <span className="val">{text}</span>
          </div>
        );
      })}
    </div>
  );
}
