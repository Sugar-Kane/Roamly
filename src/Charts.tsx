// The only recharts consumers, split into their own lazily-loaded chunk so
// recharts (+ its d3 deps, a large slice of the bundle) doesn't ship in the
// initial load for users who never open Analytics. App.tsx imports this via
// React.lazy behind a Suspense fallback.
import { BarChart, Bar, ResponsiveContainer, XAxis, Tooltip, PieChart, Pie, Cell } from "recharts";

export function WeekChart({ week }: { week: { day: string; min: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={week}>
        <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
        <Tooltip cursor={{ fill: "hsl(var(--primary) / 0.08)" }} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, color: "hsl(var(--card-foreground))" }} />
        <Bar dataKey="min" radius={[6, 6, 0, 0]} fill="hsl(var(--primary))" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SubjectDonut({ subjectSplit }: { subjectSplit: { name: string; value: number; color: string }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={subjectSplit} dataKey="value" innerRadius={45} outerRadius={70} paddingAngle={2}>
          {subjectSplit.map((s) => <Cell key={s.name} fill={s.color} />)}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}

// Admin dashboard: active students per day. Same themed bar treatment as
// WeekChart, but with a labeled tooltip carrying both students and events.
export function AdminActivityChart({ days }: { days: { day: string; active_users: number; events: number }[] }) {
  return (
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
  );
}
