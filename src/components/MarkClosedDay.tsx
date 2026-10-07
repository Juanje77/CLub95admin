"use client";
import { markDayAsClosed } from "../app/actions";
import { useAction } from "./useAction";

export default function MarkClosedDay({ date }: { date: string }) {
  const { pending, run, toast } = useAction();
  return (
    <>
      <button className="btn" disabled={pending} onClick={() => run(() => markDayAsClosed({ date, reason: "No abrió" }))}>
        No abrimos ese día
      </button>
      {toast}
    </>
  );
}
