"use client";

export default function PrintButton() {
  return (
    <button className="btn" type="button" onClick={() => window.print()}>
      Imprimir / guardar PDF
    </button>
  );
}
