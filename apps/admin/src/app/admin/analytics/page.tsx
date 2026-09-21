import AnalyticsDashboard from "./analytics-dashboard";

// Server shell for the analytics dashboard. The layout enforces the
// analytics:view policy gate; the dashboard itself client-fetches
// GET /api/admin/analytics (skeleton → data / error + retry, no polling).
export default function AdminAnalyticsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Analitik</h2>
          <p className="text-sm text-muted-foreground">
            Ringkasan pendapatan, pesanan, dan aktivitas terbaru.
          </p>
        </div>
      </div>

      <AnalyticsDashboard />
    </div>
  );
}