import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useStore } from "../store";
import type { LocationStatus } from "../types";
import { Icon, PageHeader, Spinner } from "../components/ui";
import { CafeStatus, hoursText } from "../components/common";

export function LocationsPage() {
  const { locationId, setLocationId, cartCount, toast } = useStore();
  const [locs, setLocs] = useState<LocationStatus[] | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    api<{ locations: LocationStatus[] }>("/locations").then((r) => setLocs(r.locations)).catch((e) => toast(e.message, "error"));
  }, [toast]);

  const choose = (l: LocationStatus) => {
    if (l.id !== locationId && cartCount > 0 && !window.confirm(`Switch to ${l.name}? We'll keep your bag and re-check prices and availability there.`)) return;
    setLocationId(l.id);
    nav(-1);
  };

  return (
    <div className="page">
      <PageHeader title="Choose a café" back />
      {!locs ? <Spinner /> : (
        <ul className="stack">
          {locs.map((l) => (
            <li key={l.id}>
              <button className={`loc-card${l.id === locationId ? " on" : ""}`} onClick={() => choose(l)}>
                <div className="row-between">
                  <div>
                    <div className="loc-name">{l.name}</div>
                    <div className="small muted">{l.address}</div>
                  </div>
                  {l.id === locationId ? <span className="badge"><Icon name="check" size={14} /> Selected</span> : null}
                </div>
                <CafeStatus loc={l} />
                <details onClick={(e) => e.stopPropagation()}>
                  <summary>Hours</summary>
                  <table className="hours">
                    <tbody>
                      {hoursText(l.hours).map((h) => <tr key={h.day}><td>{h.day}</td><td>{h.text}</td></tr>)}
                    </tbody>
                  </table>
                </details>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
