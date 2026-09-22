import { TrendingUp, ShoppingCart, Clock, AlertTriangle, Bell } from 'lucide-react';
import { Card, CardContent } from '@ury/ui';
import { useState, useEffect } from 'react';
import { usePOSStore } from '../store/pos-store';
import { formatCurrency, call } from '@ury/core';
import HufLogo from '../components/HufLogo';

// Helper function to format relative time
function getRelativeTime(creationDate: string): string {
  const now = new Date();
  const date = new Date(creationDate);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hr ago`;
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
}

// Helper to format ETA minutes into readable time
function formatETA(minutes: number | null): string {
  if (minutes === null) return 'Holds';
  if (minutes <= 90) return `~${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `~${hours} hr ${mins > 0 ? `${mins} min` : ''}`.trim();
}

export default function Dashboard() {
  const { posProfile } = usePOSStore();
  const [stats, setStats] = useState<any[]>([]);
  const [shiftMetrics, setShiftMetrics] = useState<any>(null);
  const [baseline, setBaseline] = useState<any>(null);
  const [runningLow, setRunningLow] = useState<any[]>([]);
  const [needsAttention, setNeedsAttention] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [runningLowLoading, setRunningLowLoading] = useState(false);
  const [needsAttentionLoading, setNeedsAttentionLoading] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [runningLowError, setRunningLowError] = useState<string | null>(null);
  const [needsAttentionError, setNeedsAttentionError] = useState<string | null>(null);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);

  useEffect(() => {
    if (!posProfile?.branch) return;

    const fetchDashboardData = async () => {

      // Fetch dashboard stats
      setStatsLoading(true);
      setStatsError(null);
      try {
        const statsRes = await call.get('ury.ury.api.ury_dashboard.get_dashboard_stats', {
          branch: posProfile.branch
        });
        const statsData = statsRes.message;
        setStats([
          {
            label: "Today's Sales",
            value: formatCurrency(statsData.todays_sales),
            icon: TrendingUp,
            color: 'text-green-600'
          },
          {
            label: 'Orders Today',
            value: String(statsData.orders_today),
            icon: ShoppingCart,
            color: 'text-blue-600'
          },
          {
            label: 'Avg. Order Value',
            value: formatCurrency(statsData.avg_order_value),
            icon: Clock,
            color: 'text-purple-600'
          }
        ]);
      } catch (err) {
        setStatsError('Failed to load stats');
        console.error('Error fetching stats:', err);
      } finally {
        setStatsLoading(false);
      }

      // Fetch shift metrics and baseline
      setMetricsLoading(true);
      setMetricsError(null);
      try {
        const metricsRes = await call.get('ury.ury.api.ury_dashboard.get_shift_metrics', {
          branch: posProfile.branch
        });
        setShiftMetrics(metricsRes.message);

        const baselineRes = await call.get('ury.ury.api.ury_dashboard.get_baseline', {
          branch: posProfile.branch
        });
        setBaseline(baselineRes.message);
      } catch (err) {
        setMetricsError('Failed to load metrics');
        console.error('Error fetching metrics:', err);
      } finally {
        setMetricsLoading(false);
      }

      // Fetch running low items
      setRunningLowLoading(true);
      setRunningLowError(null);
      try {
        const runningRes = await call.get('ury.ury.api.ury_service_line.get_running_low', {
          branch: posProfile.branch
        });
        const runningData = Array.isArray(runningRes.message) ? runningRes.message : [];
        setRunningLow(runningData);
      } catch (err) {
        setRunningLowError('Failed to load running low items');
        console.error('Error fetching running low:', err);
      } finally {
        setRunningLowLoading(false);
      }

      // Fetch needs attention
      setNeedsAttentionLoading(true);
      setNeedsAttentionError(null);
      try {
        const attentionRes = await call.get('ury.ury.api.ury_dashboard.get_needs_attention', {
          branch: posProfile.branch
        });
        const attentionData = attentionRes.message;
        if (Array.isArray(attentionData) && attentionData.length > 0) {
          const processedAttention = attentionData.map((item, idx) => ({
            id: idx,
            message: item.message,
            icon: item.severity === 'high' ? AlertTriangle : Clock,
            severity: item.severity
          }));
          setNeedsAttention(processedAttention);
        } else {
          setNeedsAttention([]);
        }
      } catch (err) {
        setNeedsAttentionError('Failed to load needs attention');
        console.error('Error fetching needs attention:', err);
      } finally {
        setNeedsAttentionLoading(false);
      }

      // Fetch recent notifications
      setNotificationsLoading(true);
      setNotificationsError(null);
      try {
        const params = new URLSearchParams({
          doctype: 'Notification Log',
          fields: JSON.stringify(['name', 'subject', 'creation']),
          order_by: 'creation desc',
          limit_page_length: '10'
        });
        const notificationsRes = await fetch(
          `/api/method/frappe.client.get_list?${params.toString()}`
        );
        if (!notificationsRes.ok) throw new Error('Failed to fetch notifications');
        const notificationsData = await notificationsRes.json();
        const processedNotifications = (notificationsData.message || []).map((notif: any) => ({
          id: notif.name,
          message: notif.subject,
          timestamp: getRelativeTime(notif.creation)
        }));
        setNotifications(processedNotifications);
      } catch (err) {
        setNotificationsError('Failed to load notifications');
        console.error('Error fetching notifications:', err);
      } finally {
        setNotificationsLoading(false);
      }
    };

    fetchDashboardData();
  }, [posProfile?.branch]);

  return (
    <div className="h-full overflow-y-auto p-6 bg-gray-50 space-y-6">
      {/* 1. Stat Cards Row (Aligned with Core UI & Icons Preserved) */}
      <section className="w-full">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {statsError ? (
            <div className="col-span-full text-red-600 text-sm">Failed to load stats</div>
          ) : statsLoading ? (
            <div className="col-span-full text-gray-600 text-sm">Loading...</div>
          ) : (
            stats.map((stat, index) => {
              const IconComponent = stat.icon;
              return (
                <Card
                  key={index}
                  className="rounded-lg border border-gray-200 bg-white p-5 shadow-xs transition-all duration-200 hover:shadow-md hover:border-primary/20"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-gray-600">{stat.label}</span>
                    {IconComponent && <IconComponent className={`w-4 h-4 ${stat.color}`} />}
                  </div>
                  <p className="text-2xl font-bold text-gray-900 tracking-tight">{stat.value}</p>
                </Card>
              );
            })
          )}
        </div>
      </section>

      {/* 2. Two-column layout (v3-test design) */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Left column - stacked sections */}
        <div className="space-y-6">
          {/* Needs Attention Section */}
          <Card className="bg-white border border-gray-200">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                <h3 className="text-lg font-semibold text-gray-900">Needs Attention</h3>
              </div>
              <div className="space-y-3">
                {needsAttentionError ? (
                  <p className="text-red-600 text-sm">Failed to load</p>
                ) : needsAttentionLoading ? (
                  <p className="text-gray-600 text-sm">Loading...</p>
                ) : needsAttention.length === 0 ? (
                  <p className="text-gray-600 text-sm">Nothing needs attention right now.</p>
                ) : (
                  needsAttention.map((item) => {
                    const ItemIcon = item.icon;
                    const severityColor = item.severity === 'high'
                      ? 'border-l-4 border-l-red-500 bg-red-50'
                      : 'border-l-4 border-l-amber-500 bg-amber-50';
                    return (
                      <div key={item.id} className={`p-3 rounded ${severityColor}`}>
                        <div className="flex items-center gap-3">
                          <ItemIcon className={`w-4 h-4 flex-shrink-0 ${item.severity === 'high' ? 'text-red-600' : 'text-amber-600'}`} />
                          <p className="text-sm text-gray-700">{item.message}</p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>

          {/* Tonight vs Baseline */}
          <Card className="bg-white border border-gray-200">
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Tonight vs Baseline</h3>
              {metricsError ? (
                <p className="text-red-600 text-sm">Failed to load metrics</p>
              ) : metricsLoading ? (
                <p className="text-gray-600 text-sm">Loading...</p>
              ) : !shiftMetrics || !baseline ? (
                <p className="text-gray-600 text-sm">No data available</p>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {/* Sales */}
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-600 mb-1">Sales</p>
                    <p className="text-lg font-bold text-gray-900">{formatCurrency(shiftMetrics.sales)}</p>
                    {baseline.sample_days > 0 && (
                      <p className="text-xs mt-1">
                        <span className={shiftMetrics.sales >= baseline.median_sales ? 'text-green-600' : 'text-red-600'}>
                          {shiftMetrics.sales >= baseline.median_sales ? '+' : ''}{((shiftMetrics.sales - baseline.median_sales) / baseline.median_sales * 100).toFixed(0)}%
                        </span>
                        <span className="text-gray-600"> vs {formatCurrency(baseline.median_sales)}</span>
                      </p>
                    )}
                  </div>

                  {/* Covers */}
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-600 mb-1">Covers</p>
                    <p className="text-lg font-bold text-gray-900">{shiftMetrics.covers}</p>
                    {baseline.sample_days > 0 && (
                      <p className="text-xs mt-1">
                        <span className={shiftMetrics.covers >= baseline.median_covers ? 'text-green-600' : 'text-red-600'}>
                          {shiftMetrics.covers >= baseline.median_covers ? '+' : ''}{shiftMetrics.covers - baseline.median_covers}
                        </span>
                        <span className="text-gray-600"> vs {baseline.median_covers}</span>
                      </p>
                    )}
                  </div>

                  {/* Avg per Cover */}
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-600 mb-1">Avg per Cover</p>
                    <p className="text-lg font-bold text-gray-900">{formatCurrency(shiftMetrics.avg_per_cover)}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Running Low Section */}
          <Card className="bg-white border border-gray-200">
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Running Low</h3>
              {runningLowError ? (
                <p className="text-red-600 text-sm">Failed to load</p>
              ) : runningLowLoading ? (
                <p className="text-gray-600 text-sm">Loading...</p>
              ) : runningLow.length === 0 ? (
                <p className="text-gray-600 text-sm">No items selling fast enough to forecast yet.</p>
              ) : (
                <div className="space-y-3">
                  {runningLow.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-900 truncate">{item.item_name}</span>
                          <span className="text-xs text-gray-600 ml-2 flex-shrink-0">{formatETA(item.eta_minutes)}</span>
                        </div>
                        <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-500 rounded-full"
                            style={{ width: `${Math.min((item.remaining / (item.remaining + item.qty_sold_today)) * 100, 100)}%` }}
                          />
                        </div>
                        {item.data_quality_issue && (
                          <p className="text-xs text-gray-500 mt-1">(stock data needs review)</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column - narrow rail */}
        <div className="space-y-6">
          {/* Shift Brief Section (with HUF Logo) */}
          <Card className="bg-white border border-gray-200">
            <CardContent className="p-6">
              <div className="flex items-center justify-between gap-2 mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Shift Brief</h3>
                <span className="inline-flex items-center justify-center px-2 py-1 bg-purple-50 text-purple-700 border border-purple-200 rounded">
                  <HufLogo className="h-3.5 w-auto" />
                </span>
              </div>
              <p className="text-sm text-gray-600">
                AI-written shift summaries are not yet connected. This panel will show HUF&apos;s shift observations once integrated.
              </p>
            </CardContent>
          </Card>

          {/* Recent Notifications Section */}
          <Card className="bg-white border border-gray-200">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Bell className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-semibold text-gray-900">Recent Notifications</h3>
              </div>
              <div className="space-y-2">
                {notificationsError ? (
                  <p className="text-red-600 text-sm">Failed to load</p>
                ) : notificationsLoading ? (
                  <p className="text-gray-600 text-sm">Loading...</p>
                ) : notifications.length === 0 ? (
                  <p className="text-gray-600 text-sm">No recent notifications.</p>
                ) : (
                  notifications.map((notification) => (
                    <div key={notification.id} className="flex items-start justify-between py-2 border-b border-gray-100 last:border-b-0">
                      <p className="text-xs text-gray-700">{notification.message}</p>
                      <span className="text-xs text-gray-500 ml-2 flex-shrink-0 whitespace-nowrap">{notification.timestamp}</span>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
