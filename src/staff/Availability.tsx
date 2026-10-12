import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { Spinner } from "../components/ui";

interface Data {
  products: { id: string; name: string; categoryId: string; soldOut: boolean; unavailable: boolean; active: boolean }[];
  ingredients: { name: string; sold_out: number }[];
}

const pretty = (s: string) => s.replace(/_/g, " ").replace(/\b(sf)\b/, "sugar-free").replace(/^\w/, (c) => c.toUpperCase());

export function AvailabilityPanel({ locationId }: { locationId: string }) {
  const { toast } = useStore();
  const [data, setData] = useState<Data | null>(null);
  const load = useCallback(() => api<Data>(`/staff/locations/${locationId}/availability`).then(setData).catch((e) => toast(e.message, "error")), [locationId, toast]);
  useEffect(() => { load(); }, [load]);

  const set = async (body: { productId?: string; ingredient?: string; soldOut: boolean }) => {
    try {
      await api(`/staff/locations/${locationId}/availability`, { body });
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  if (!data) return <Spinner />;
  return (
    <div className="avail">
      <h3>Ingredients</h3>
      <p className="small muted">Marking an ingredient sold out hides that option and any drink that needs it.</p>
      <div className="avail-grid">
        {data.ingredients.map((i) => (
          <label key={i.name} className={`avail-chip${i.sold_out ? " out" : ""}`}>
            <input type="checkbox" checked={!!i.sold_out} onChange={(e) => set({ ingredient: i.name, soldOut: e.target.checked })} />
            {pretty(i.name)} {i.sold_out ? "· OUT" : ""}
          </label>
        ))}
      </div>
      <h3>Menu items</h3>
      <div className="avail-grid">
        {data.products.filter((p) => p.active).map((p) => (
          <label key={p.id} className={`avail-chip${p.soldOut ? " out" : p.unavailable ? " dim" : ""}`}>
            <input type="checkbox" checked={p.soldOut} onChange={(e) => set({ productId: p.id, soldOut: e.target.checked })} />
            {p.name} {p.soldOut ? "· OUT" : p.unavailable ? "· ingredient out" : ""}
          </label>
        ))}
      </div>
    </div>
  );
}
