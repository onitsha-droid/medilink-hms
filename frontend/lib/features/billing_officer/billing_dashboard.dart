import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../core/api/clinical_models.dart';
import '../../core/providers/clinical_repository.dart';
import '../../core/providers/auth_provider.dart';

// ── Providers ─────────────────────────────────────────────────────────────────

class _InvoiceFilter {
  const _InvoiceFilter({this.status, this.patientId, this.page = 1});
  final String? status;
  final String? patientId;
  final int page;
}

final invoiceFilterProvider =
    StateProvider.autoDispose<_InvoiceFilter>(
  (_) => const _InvoiceFilter(),
);

final billingInvoicesProvider =
    FutureProvider.autoDispose<List<Invoice>>((ref) {
  final filter = ref.watch(invoiceFilterProvider);
  return ref.read(clinicalRepositoryProvider).getInvoices(
        status: filter.status,
        page: filter.page,
      );
});

// ── Billing Officer Dashboard ─────────────────────────────────────────────────

class BillingDashboard extends ConsumerWidget {
  const BillingDashboard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final invoicesAsync = ref.watch(billingInvoicesProvider);
    final filter = ref.watch(invoiceFilterProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Billing Dashboard'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () =>
                ref.invalidate(billingInvoicesProvider),
          ),
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () =>
                ref.read(authProvider.notifier).logout(),
          ),
        ],
      ),
      body: Column(
        children: [
          // ── Filter bar ──────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
            child: Row(
              children: [
                const Text('Filter: '),
                const SizedBox(width: 8),
                ...[null, 'pending', 'paid', 'cancelled'].map(
                  (s) => Padding(
                    padding: const EdgeInsets.only(right: 4),
                    child: FilterChip(
                      label: Text(s ?? 'All'),
                      selected: filter.status == s,
                      onSelected: (_) => ref
                          .read(invoiceFilterProvider.notifier)
                          .state = _InvoiceFilter(status: s),
                    ),
                  ),
                ),
              ],
            ),
          ),
          // ── List ────────────────────────────────────────────────
          Expanded(
            child: invoicesAsync.when(
              loading: () =>
                  const Center(child: CircularProgressIndicator()),
              error: (e, _) =>
                  Center(child: Text('Error: $e')),
              data: (invoices) {
                if (invoices.isEmpty) {
                  return const Center(
                      child: Text('No invoices found.'));
                }
                return RefreshIndicator(
                  onRefresh: () async =>
                      ref.invalidate(billingInvoicesProvider),
                  child: ListView.separated(
                    padding: const EdgeInsets.all(12),
                    itemCount: invoices.length,
                    separatorBuilder: (_, __) =>
                        const SizedBox(height: 8),
                    itemBuilder: (context, i) =>
                        _BillingInvoiceCard(invoice: invoices[i]),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

// ── Invoice Card (list item) ─────────────────────────────────────────────────

class _BillingInvoiceCard extends StatelessWidget {
  const _BillingInvoiceCard({required this.invoice});
  final Invoice invoice;

  @override
  Widget build(BuildContext context) {
    final dateStr = invoice.createdAt != null
        ? DateFormat('dd MMM yyyy').format(invoice.createdAt!)
        : '—';
    final totalStr =
        '₦${invoice.totalNaira.toStringAsFixed(2)}';
    final statusColor = switch (invoice.status) {
      'paid' => Colors.green,
      'cancelled' => Colors.grey,
      _ => Colors.orange,
    };

    return Card(
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: statusColor.withOpacity(0.15),
          child: Icon(Icons.receipt_long, color: statusColor),
        ),
        title: Text(
          invoice.patientName ?? invoice.patientHospitalId ?? 'Patient',
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        subtitle: Text('$dateStr · ${invoice.status.toUpperCase()}'),
        trailing: Text(totalStr,
            style: TextStyle(
                fontWeight: FontWeight.bold,
                color: statusColor,
                fontSize: 15)),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) =>
                BillingInvoiceDetailScreen(invoice: invoice),
          ),
        ),
      ),
    );
  }
}

// ── Invoice Detail: receipt view + adjust + cancel ───────────────────────────

class BillingInvoiceDetailScreen extends ConsumerStatefulWidget {
  const BillingInvoiceDetailScreen({super.key, required this.invoice});
  final Invoice invoice;

  @override
  ConsumerState<BillingInvoiceDetailScreen> createState() =>
      _BillingInvoiceDetailScreenState();
}

class _BillingInvoiceDetailScreenState
    extends ConsumerState<BillingInvoiceDetailScreen> {
  late Invoice _invoice;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _invoice = widget.invoice;
  }

  Future<void> _showAdjustDialog() async {
    final deltaCtrl = TextEditingController();
    final reasonCtrl = TextEditingController();

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Adjust Invoice'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextFormField(
              controller: deltaCtrl,
              keyboardType: TextInputType.numberWithOptions(signed: true),
              decoration: const InputDecoration(
                labelText: 'Amount (kobo, negative = discount)',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: reasonCtrl,
              decoration: const InputDecoration(
                labelText: 'Reason *',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('CANCEL'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('APPLY'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    final delta = int.tryParse(deltaCtrl.text.trim());
    if (delta == null) {
      setState(() => _error = 'Delta must be an integer');
      return;
    }
    if (reasonCtrl.text.trim().isEmpty) {
      setState(() => _error = 'Reason is required');
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final updated = await ref
          .read(clinicalRepositoryProvider)
          .adjustInvoice(
            invoiceId: _invoice.id,
            deltaKobo: delta,
            reason: reasonCtrl.text.trim(),
          );
      setState(() => _invoice = updated);
      ref.invalidate(billingInvoicesProvider);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      setState(() => _busy = false);
    }
  }

  Future<void> _cancel() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cancel Invoice?'),
        content: const Text(
            'This cannot be undone. The invoice will be marked cancelled.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('NO'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
                backgroundColor: Colors.red),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('CANCEL INVOICE'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final updated = await ref
          .read(clinicalRepositoryProvider)
          .cancelInvoice(_invoice.id);
      setState(() => _invoice = updated);
      ref.invalidate(billingInvoicesProvider);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final inv = _invoice;
    final isPending = inv.status == 'pending';
    final isPaid = inv.status == 'paid';

    return Scaffold(
      appBar: AppBar(
        title: Text(inv.patientName ?? 'Invoice'),
        actions: [
          if (isPending)
            IconButton(
              icon: const Icon(Icons.tune),
              tooltip: 'Adjust',
              onPressed: _busy ? null : _showAdjustDialog,
            ),
          if (isPending)
            IconButton(
              icon: const Icon(Icons.cancel_outlined,
                  color: Colors.red),
              tooltip: 'Cancel invoice',
              onPressed: _busy ? null : _cancel,
            ),
        ],
      ),
      body: _busy
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(_error!,
                        style:
                            const TextStyle(color: Colors.red)),
                  ),

                // ── Header ──────────────────────────────────
                _Section(
                  title: 'Invoice Summary',
                  child: Column(
                    crossAxisAlignment:
                        CrossAxisAlignment.start,
                    children: [
                      _Row('Patient',
                          inv.patientName ?? '—'),
                      _Row('Status',
                          inv.status.toUpperCase()),
                      if (inv.createdAt != null)
                        _Row(
                            'Date',
                            DateFormat('dd MMM yyyy HH:mm')
                                .format(inv.createdAt!)),
                      if (isPaid && inv.paidAt != null)
                        _Row(
                            'Paid at',
                            DateFormat('dd MMM yyyy HH:mm')
                                .format(inv.paidAt!)),
                      if (inv.receiptNumber != null)
                        _Row('Receipt',
                            inv.receiptNumber!),
                    ],
                  ),
                ),
                const SizedBox(height: 12),

                // ── Line items ───────────────────────────────
                _Section(
                  title: 'Line Items',
                  child: Column(
                    children: [
                      ...inv.lineItems.map(
                        (item) => Padding(
                          padding: const EdgeInsets.symmetric(
                              vertical: 4),
                          child: Row(
                            children: [
                              Expanded(
                                child: Text(item.description),
                              ),
                              Text(
                                  '₦${item.amountNaira.toStringAsFixed(2)}'),
                            ],
                          ),
                        ),
                      ),
                      const Divider(),
                      Row(
                        children: [
                          const Expanded(
                            child: Text('TOTAL',
                                style: TextStyle(
                                    fontWeight:
                                        FontWeight.bold)),
                          ),
                          Text(
                            '₦${inv.totalNaira.toStringAsFixed(2)}',
                            style: const TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 16),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),

                // ── Receipt (if paid) ────────────────────────
                if (isPaid) ...[
                  const SizedBox(height: 12),
                  _Section(
                    title: 'Digital Receipt',
                    child: Column(
                      crossAxisAlignment:
                          CrossAxisAlignment.start,
                      children: [
                        _Row('Receipt No',
                            inv.receiptNumber ?? '—'),
                        _Row('Amount',
                            '₦${inv.totalNaira.toStringAsFixed(2)}'),
                        _Row('Method',
                            inv.status == 'paid' ? 'Fiat' : '—'),
                        if (inv.paidAt != null)
                          _Row(
                              'Paid',
                              DateFormat('dd MMM yyyy HH:mm')
                                  .format(inv.paidAt!)),
                      ],
                    ),
                  ),
                ],
              ],
            ),
    );
  }
}

// ── Shared widgets ────────────────────────────────────────────────────────────

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.child});
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title,
                style: Theme.of(context)
                    .textTheme
                    .titleSmall
                    ?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            child,
          ],
        ),
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          SizedBox(
            width: 90,
            child: Text(label,
                style: TextStyle(
                    color: Colors.grey.shade600,
                    fontSize: 13)),
          ),
          Expanded(
            child: Text(value,
                style: const TextStyle(fontSize: 13)),
          ),
        ],
      ),
    );
  }
}
