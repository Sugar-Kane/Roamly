// The only recharts consumers, split into their own lazily-loaded chunk so
// recharts (+ its d3 deps, a large slice of the bundle) doesn't ship in the
// initial load for users who never open Analytics. App.tsx imports this via
// React.lazy behind a Suspense fallback.
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend } from "recharts";

// Shared themed tooltip/axis styling so every admin chart reads as one system.
const AXIS = { axisLine: false, tickLine: false, tick: { fill: "hsl(var(--muted-foreground))", fontSize: 11 } } as const;
const TOOLTIP = { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, color: "hsl(var(--card-foreground))", fontSize: 12 } as const;

// Admin dashboard: a multi-series line trend (e.g. active users over time).
export function AdminTrendChart({ data, series }: {
  data: Record<string, number | string>[];
  series: { key: string; label: string; color: string }[];
}) {
  return (
    <div className="h-full w-full" role="img"
      aria-label={`Line trend chart over time. Series: ${series.map((s) => s.label).join(", ")}. See the adjacent metrics for exact values.`}>
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid vertical={false} stroke="hsl(var(--border) / 0.6)" />
        <XAxis dataKey="day" {...AXIS} minTickGap={24} />
        <YAxis {...AXIS} width={40} allowDecimals={false} />
        <Tooltip cursor={{ stroke: "hsl(var(--border))" }} contentStyle={TOOLTIP} />
        <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color}
            strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
    </div>
  );
}

// Admin dashboard: composition over time (e.g. new vs returning), stacked bars.
export function AdminStackedBars({ data, series }: {
  data: Record<string, number | string>[];
  series: { key: string; label: string; color: string }[];
}) {
  return (
    <div className="h-full w-full" role="img"
      aria-label={`Stacked bar chart over time. Series: ${series.map((s) => s.label).join(", ")}. See the adjacent metrics for exact values.`}>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid vertical={false} stroke="hsl(var(--border) / 0.6)" />
        <XAxis dataKey="day" {...AXIS} minTickGap={24} />
        <YAxis {...AXIS} width={40} allowDecimals={false} />
        <Tooltip cursor={{ fill: "hsl(var(--primary) / 0.08)" }} contentStyle={TOOLTIP} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color}
            radius={i === series.length - 1 ? [4, 4, 0, 0] : undefined} />
        ))}
      </BarChart>
    </ResponsiveContainer>
    </div>
  );
}

export function WeekChart({ week }: { week: { day: string; min: number }[] }) {
  // The bar chart is a visual convenience; the equivalent data is exposed to
  // assistive tech as a real data table (WCAG 1.1.1 / 1.3.1). The SVG chart is
  // hidden from AT so it isn't read as an unlabeled graphic, and the tooltip —
  // which is pointer-only — is not the sole way to read a value.
  const total = week.reduce((a, b) => a + b.min, 0);
  return (
    <figure className="m-0 h-full w-full">
      <div className="h-full w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={week}>
            <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
            <Tooltip cursor={{ fill: "hsl(var(--primary) / 0.08)" }} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, color: "hsl(var(--card-foreground))" }} />
            <Bar dataKey="min" radius={[6, 6, 0, 0]} fill="hsl(var(--primary))" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">
        <table>
          <caption>Focus minutes by day over the last 7 days. Total {total} minutes.</caption>
          <thead><tr><th scope="col">Day</th><th scope="col">Minutes</th></tr></thead>
          <tbody>
            {week.map((d) => (
              <tr key={d.day}><th scope="row">{d.day}</th><td>{d.min} minutes</td></tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}

// The donut is purely decorative here: the caller renders a visible, text-based
// legend (subject name + percentage) next to it, which is the accessible
// alternative. The SVG is hidden from assistive tech so it isn't announced as
// an unlabeled graphic (WCAG 1.1.1).
export function SubjectDonut({ subjectSplit }: { subjectSplit: { name: string; value: number; color: string }[] }) {
  return (
    <div className="h-full w-full" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={subjectSplit} dataKey="value" innerRadius={45} outerRadius={70} paddingAngle={2}>
            {subjectSplit.map((s) => <Cell key={s.name} fill={s.color} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// Admin dashboard: active students per day. Same themed bar treatment as
// WeekChart, but with a labeled tooltip carrying both students and events.
export function AdminActivityChart({ days }: { days: { day: string; active_users: number; events: number }[] }) {
  return (
    <div className="h-full w-full" role="img" aria-label="Bar chart of active students and actions per day. See the adjacent metrics for exact values.">
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={days}>
        <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
        <Tooltip cursor={{ fill: "hsl(var(--primary) / 0.08)" }}
          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, color: "hsl(var(--card-foreground))" }}
          formatter={(value, key) => [value ?? 0, key === "active_users" ? "Students" : "Actions"]} />
        <Bar dataKey="active_users" radius={[6, 6, 0, 0]} fill="hsl(var(--primary))" />
        <Bar dataKey="events" radius={[6, 6, 0, 0]} fill="hsl(var(--primary) / 0.35)" />
      </BarChart>
    </ResponsiveContainer>
    </div>
  );
}
