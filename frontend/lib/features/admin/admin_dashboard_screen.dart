import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/hmo_models.dart';
import '../../core/providers/clinical_repository.dart';
import '../../core/providers/auth_provider.dart';

// ── Providers ─────────────────────────────────────────────────────────────────

final adminDashboardProvider =
    FutureProvider.autoDispose<AdminDashboard>((ref) =>
        ref.read(clinicalRepositoryProvider).getAdminDashboard());

// ── Admin Dashboard ───────────────────────────────────────────────────────────

class AdminDashboardScreen extends ConsumerWidget {
  const AdminDashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dashAsync = ref.watch(adminDashboardProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Admin Dashboard'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(adminDashboardProvider),
          ),
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () => ref.read(authProvider.notifier).logout(),
          ),
        ],
      ),
      body: dashAsync.when(
        loading: () =>
            const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Error: $e')),
        data: (dash) => RefreshIndicator(
          onRefresh: () async =>
              ref.invalidate(adminDashboardProvider),
          child: ListView(
            padding: const EdgeInsets.all(12),
            children: [
              // ── KPI row ───────────────────────────────────────────
              Row(
                children: [
                  Expanded(
                    child: _KpiCard(
                      label: 'Patients Today',
                      value: dash.patientsToday.toString(),
                      icon: Icons.people,
                      color: Colors.blue,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _KpiCard(
                      label: 'Fiat Revenue',
                      value:
                          '₦${(dash.revenueFiatNaira).toStringAsFixed(0)}',
                      icon: Icons.payments,
                      color: Colors.green,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _KpiCard(
                      label: 'USDC Revenue',
                      value:
                          '\$${(dash.revenueStablecoinNaira).toStringAsFixed(0)}',
                      icon: Icons.currency_exchange,
                      color: Colors.purple,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),

              // ── Queue per clinic ──────────────────────────────────
              _SectionHeader('Live Queue'),
              if (dash.queue.isEmpty)
                const Padding(
                  padding: EdgeInsets.all(8),
                  child: Text('No active queues.'),
                )
              else
                ...dash.queue.map((q) => _QueueMetricTile(metric: q)),
              const SizedBox(height: 12),

              // ── Low stock alert ───────────────────────────────────
              if (dash.lowStock.isNotEmpty) ...[
                _SectionHeader(
                  'Low Stock (${dash.lowStock.length} item(s))',
                  color: Colors.orange,
                ),
                ...dash.lowStock.map((item) => ListTile(
                      dense: true,
                      leading: const Icon(Icons.warning_amber,
                          color: Colors.orange, size: 20),
                      title: Text(
                        '${item['drugName']} · ${item['formulation']}',
                        style: const TextStyle(fontSize: 13),
                      ),
                      trailing: Text(
                        '${item['quantityOnHand']} left',
                        style: const TextStyle(
                            color: Colors.red,
                            fontWeight: FontWeight.bold,
                            fontSize: 12),
                      ),
                    )),
                const SizedBox(height: 12),
              ],

              // ── Claims status ──────────────────────────────────────
              _SectionHeader('HMO Claims'),
              if (dash.claims.isEmpty)
                const Padding(
                  padding: EdgeInsets.all(8),
                  child: Text('No claims yet.'),
                )
              else
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      children: [
                        for (final entry in dash.claims.entries)
                          Padding(
                            padding:
                                const EdgeInsets.symmetric(vertical: 4),
                            child: Row(
                              children: [
                                Expanded(
                                    child: Text(
                                        entry.key.toUpperCase(),
                                        style: const TextStyle(
                                            fontSize: 13))),
                                Text(
                                  '${(entry.value as Map)['count'] ?? 0} claim(s)',
                                  style: const TextStyle(
                                      fontWeight: FontWeight.bold,
                                      fontSize: 13),
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

// ── Widgets ───────────────────────────────────────────────────────────────────

class _KpiCard extends StatelessWidget {
  const _KpiCard({
    required this.label,
    required this.value,
    required this.icon,
    required this.color,
  });
  final String label;
  final String value;
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 8),
          child: Column(
            children: [
              Icon(icon, color: color, size: 26),
              const SizedBox(height: 4),
              Text(value,
                  style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                      color: color)),
              const SizedBox(height: 2),
              Text(label,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                      fontSize: 11, color: Colors.grey.shade600)),
            ],
          ),
        ),
      );
}

class _QueueMetricTile extends StatelessWidget {
  const _QueueMetricTile({required this.metric});
  final ClinicQueueMetric metric;

  @override
  Widget build(BuildContext context) => Card(
        margin: const EdgeInsets.only(bottom: 6),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(metric.clinicName,
                        style: const TextStyle(
                            fontWeight: FontWeight.bold)),
                    Text(
                      '${metric.queueLength} waiting'
                      '${metric.urgent > 0 ? ' · ${metric.urgent} urgent' : ''}',
                      style: TextStyle(
                          fontSize: 12, color: Colors.grey.shade600),
                    ),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text('~${metric.estimatedWaitMinutes} min',
                      style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 14)),
                  Text('est. wait',
                      style: TextStyle(
                          fontSize: 11, color: Colors.grey.shade500)),
                ],
              ),
            ],
          ),
        ),
      );
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.title, {this.color});
  final String title;
  final Color? color;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(
          title,
          style: Theme.of(context).textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.bold,
                color: color,
              ),
        ),
      );
}
