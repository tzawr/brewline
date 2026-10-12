// Hand-drawn SVG product art: top-down mugs for milk drinks, cups for brewed coffee,
// clear cups for iced drinks, and simple food shapes. Purely decorative (aria-hidden).

type Spec =
  | { kind: "mug"; drink: string; foam: string; art: "heart" | "rosetta" | "dust" | "none"; bg: string }
  | { kind: "cup"; drink: string; sleeve: string; bg: string }
  | { kind: "iced"; drink: string; top?: string; bg: string }
  | { kind: "food"; food: string; bg: string };

const SPECS: Record<string, Spec> = {
  latte: { kind: "mug", drink: "#b9875e", foam: "#f4e6d3", art: "rosetta", bg: "#f3e7da" },
  cappuccino: { kind: "mug", drink: "#a8754b", foam: "#f7ecdf", art: "dust", bg: "#efe2d3" },
  flatwhite: { kind: "mug", drink: "#9b6a43", foam: "#f1dfc9", art: "heart", bg: "#f1e5d8" },
  mocha: { kind: "mug", drink: "#6d4430", foam: "#e9d3bd", art: "heart", bg: "#eddcd0" },
  matcha: { kind: "mug", drink: "#8fae5d", foam: "#e7efd2", art: "rosetta", bg: "#e8f0dc" },
  chai: { kind: "mug", drink: "#c08a57", foam: "#f3e1c9", art: "dust", bg: "#f5e6d4" },
  hotchoc: { kind: "mug", drink: "#5a3424", foam: "#fbf4ec", art: "none", bg: "#efdfd5" },
  americano: { kind: "cup", drink: "#3b2418", sleeve: "#c8643b", bg: "#f2e3d6" },
  drip: { kind: "cup", drink: "#2f1d14", sleeve: "#2b1d16", bg: "#ece3da" },
  tea: { kind: "cup", drink: "#a0522d", sleeve: "#5d7d6a", bg: "#e6eee8" },
  icedlatte: { kind: "iced", drink: "#c49a72", top: "#7a4a2c", bg: "#e9eef2" },
  coldbrew: { kind: "iced", drink: "#4a2c1d", bg: "#e8ecef" },
  coldfoam: { kind: "iced", drink: "#4a2c1d", top: "#f1e4d2", bg: "#efeae4" },
  icedamericano: { kind: "iced", drink: "#5b3522", bg: "#e6edf1" },
  croissant: { kind: "food", food: "croissant", bg: "#f6e8d3" },
  almondcroissant: { kind: "food", food: "almondcroissant", bg: "#f4e5d0" },
  muffin: { kind: "food", food: "muffin", bg: "#e9e6f2" },
  cookie: { kind: "food", food: "cookie", bg: "#f3e6d8" },
  sandwich: { kind: "food", food: "sandwich", bg: "#f6ecd6" },
  avotoast: { kind: "food", food: "avotoast", bg: "#e7efdb" },
  oats: { kind: "food", food: "oats", bg: "#f1e9e4" },
  panini: { kind: "food", food: "panini", bg: "#f2e6d6" },
};

export function ProductArt({ art, size = 96, rounded = true }: { art: string; size?: number; rounded?: boolean }) {
  const s = SPECS[art] ?? SPECS.latte;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true" style={{ display: "block", borderRadius: rounded ? 20 : 0, flexShrink: 0 }}>
      <rect width="120" height="120" fill={s.bg} />
      <circle cx="96" cy="22" r="30" fill="#fff" opacity="0.35" />
      {s.kind === "mug" && <Mug {...s} />}
      {s.kind === "cup" && <Cup {...s} />}
      {s.kind === "iced" && <Iced {...s} />}
      {s.kind === "food" && <Food food={s.food} />}
    </svg>
  );
}

function Mug({ drink, foam, art }: { drink: string; foam: string; art: string }) {
  return (
    <g>
      <ellipse cx="60" cy="66" rx="44" ry="42" fill="#000" opacity="0.08" />
      <ellipse cx="60" cy="62" rx="44" ry="42" fill="#fffdf9" />
      <path d="M100 56 q18 2 16 18 q-2 13 -16 12" fill="none" stroke="#fffdf9" strokeWidth="8" strokeLinecap="round" />
      <circle cx="60" cy="62" r="33" fill={drink} />
      <circle cx="60" cy="62" r="33" fill="none" stroke="#000" opacity="0.08" strokeWidth="2" />
      {art === "heart" && <path d="M60 80 C44 68 42 56 51 51 C56 48 60 52 60 56 C60 52 64 48 69 51 C78 56 76 68 60 80 Z" fill={foam} />}
      {art === "rosetta" && (
        <g fill={foam}>
          <path d="M60 86 C50 74 46 62 52 52 C56 46 64 46 68 52 C74 62 70 74 60 86 Z" />
          {[0, 1, 2, 3].map((i) => (
            <path key={i} d={`M${48 + i * 0.5} ${54 + i * 7} q12 -6 24 0`} stroke={drink} strokeWidth="2.4" fill="none" opacity="0.7" />
          ))}
          <path d="M60 46 L60 88" stroke={foam} strokeWidth="2" />
        </g>
      )}
      {art === "dust" && (
        <g>
          <circle cx="60" cy="62" r="26" fill={foam} />
          {Array.from({ length: 22 }).map((_, i) => (
            <circle key={i} cx={60 + Math.cos(i * 2.4) * (i % 7) * 3.2} cy={62 + Math.sin(i * 2.4) * (i % 7) * 3.2} r="1.3" fill={drink} opacity="0.75" />
          ))}
        </g>
      )}
      {art === "none" && (
        <g fill={foam}>
          <circle cx="54" cy="58" r="13" />
          <circle cx="67" cy="62" r="12" />
          <circle cx="58" cy="70" r="11" />
        </g>
      )}
    </g>
  );
}

function Cup({ drink, sleeve }: { drink: string; sleeve: string }) {
  return (
    <g>
      <ellipse cx="60" cy="106" rx="26" ry="5" fill="#000" opacity="0.1" />
      <path d="M36 32 L84 32 L78 104 L42 104 Z" fill="#fffdf9" />
      <path d="M38.5 58 L81.5 58 L79.6 82 L40.4 82 Z" fill={sleeve} />
      <rect x="32" y="24" width="56" height="10" rx="4" fill="#fffdf9" stroke="#000" strokeOpacity="0.08" />
      <rect x="40" y="18" width="40" height="8" rx="4" fill="#fffdf9" stroke="#000" strokeOpacity="0.08" />
      <circle cx="60" cy="70" r="6" fill="#fffdf9" opacity="0.9" />
      <path d="M57 70 q3 -5 6 0 q-3 5 -6 0" fill={drink} />
      <path d="M50 8 q4 5 0 10 M60 6 q4 5 0 10 M70 8 q4 5 0 10" stroke="#8a7a6e" strokeWidth="2" fill="none" opacity="0.5" strokeLinecap="round" />
    </g>
  );
}

function Iced({ drink, top }: { drink: string; top?: string }) {
  return (
    <g>
      <ellipse cx="60" cy="108" rx="26" ry="5" fill="#000" opacity="0.1" />
      <rect x="66" y="6" width="6" height="40" rx="3" fill="#2b1d16" transform="rotate(12 69 26)" />
      <path d="M34 30 L86 30 L80 106 L40 106 Z" fill="#ffffff" opacity="0.7" />
      <path d="M36.5 44 L83.5 44 L80 104 L40 104 Z" fill={drink} />
      {top && <path d="M36.5 44 L83.5 44 L82.7 54 L37.3 54 Z" fill={top} />}
      {[
        [44, 58],
        [60, 64],
        [50, 78],
        [66, 84],
        [46, 92],
      ].map(([x, y], i) => (
        <rect key={i} x={x} y={y} width="13" height="13" rx="3" fill="#fff" opacity="0.38" transform={`rotate(${i * 17} ${x + 6} ${y + 6})`} />
      ))}
      <path d="M32 30 L88 30" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
      <path d="M42 36 L40 98" stroke="#fff" strokeWidth="3" opacity="0.6" strokeLinecap="round" />
    </g>
  );
}

function Food({ food }: { food: string }) {
  const plate = <ellipse cx="60" cy="74" rx="48" ry="30" fill="#fffdf9" />;
  switch (food) {
    case "croissant":
    case "almondcroissant":
      return (
        <g>
          {plate}
          <path d="M22 72 C26 44 94 44 98 72 C88 62 80 74 74 64 C68 74 52 74 46 64 C40 74 32 62 22 72 Z" fill="#d89a4e" />
          <path d="M46 64 C50 52 70 52 74 64" fill="none" stroke="#b5712d" strokeWidth="3" />
          <path d="M34 66 C38 56 46 54 50 56 M70 56 C74 54 82 56 86 66" fill="none" stroke="#b5712d" strokeWidth="3" />
          {food === "almondcroissant" &&
            [36, 46, 56, 66, 76, 84].map((x, i) => <ellipse key={x} cx={x} cy={54 + (i % 2) * 4} rx="4" ry="2" fill="#f6ecd8" transform={`rotate(${i * 25} ${x} 55)`} />)}
        </g>
      );
    case "muffin":
      return (
        <g>
          {plate}
          <path d="M38 64 L82 64 L76 92 L44 92 Z" fill="#c9a07a" />
          {[44, 52, 60, 68, 76].map((x) => <path key={x} d={`M${x} 64 L${x - 1} 92`} stroke="#a77c56" strokeWidth="2" />)}
          <ellipse cx="60" cy="58" rx="28" ry="18" fill="#dcae74" />
          {[[48, 54], [62, 50], [70, 60], [54, 62], [64, 58]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="3.6" fill="#4b4a8a" />)}
        </g>
      );
    case "cookie":
      return (
        <g>
          {plate}
          <circle cx="60" cy="66" r="30" fill="#d4a067" />
          <circle cx="60" cy="66" r="30" fill="none" stroke="#b9844b" strokeWidth="3" />
          {[[48, 56], [66, 54], [72, 70], [54, 76], [60, 64], [44, 68]].map(([x, y]) => <rect key={`${x}${y}`} x={x} y={y} width="7" height="6" rx="1.5" fill="#3b2418" />)}
        </g>
      );
    case "sandwich":
    case "panini":
      return (
        <g>
          {plate}
          <path d="M24 74 L60 50 L96 74 Z" fill={food === "panini" ? "#c58d4c" : "#e8c48b"} />
          <path d="M26 74 L94 74 L94 80 L26 80 Z" fill="#f2c94c" />
          <path d="M26 80 L94 80 L94 84 L26 84 Z" fill={food === "panini" ? "#e5a6a0" : "#f7e7a8"} />
          <path d="M24 84 L96 84 L60 100 Z" fill={food === "panini" ? "#b97c3e" : "#d9b071"} />
          {food === "panini" && [40, 52, 64, 76].map((x) => <path key={x} d={`M${x} 66 L${x + 10} 58`} stroke="#8e5a2a" strokeWidth="3" />)}
          <path d="M30 79 q6 4 12 0 q6 4 12 0 q6 4 12 0 q6 4 12 0 q6 4 12 0" stroke="#6ea34f" strokeWidth="3" fill="none" />
        </g>
      );
    case "avotoast":
      return (
        <g>
          {plate}
          <rect x="30" y="46" width="60" height="46" rx="12" fill="#d8a96a" />
          <rect x="35" y="51" width="50" height="36" rx="9" fill="#9cc46b" />
          {[[44, 60], [58, 66], [72, 58], [50, 76], [70, 76]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="4" fill="#6c9a3d" />)}
          {[[48, 68], [64, 58], [76, 70]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.6" fill="#c0392b" />)}
        </g>
      );
    case "oats":
      return (
        <g>
          <ellipse cx="60" cy="96" rx="34" ry="6" fill="#000" opacity="0.08" />
          <path d="M24 60 L96 60 C94 84 82 96 60 96 C38 96 26 84 24 60 Z" fill="#fffdf9" />
          <ellipse cx="60" cy="60" rx="36" ry="12" fill="#efe1c9" />
          {[[46, 58], [56, 62], [66, 56], [74, 61]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="4" fill="#4b4a8a" />)}
          {[[52, 56], [70, 64]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="4" fill="#c0392b" />)}
        </g>
      );
    default:
      return plate;
  }
}
