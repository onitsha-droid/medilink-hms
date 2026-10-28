import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../core/api/hmo_models.dart';
import '../../core/providers/clinical_repository.dart';
import '../../core/providers/auth_provider.dart';

// ── Providers ─────────────────────────────────────────────────────────────────

final hmoClaimsFilterProvider = StateProvider.autoDispose<String?>((_) => null);

final hmoClaimsProvider =
    FutureProvider.autoDispose<List<HmoClaim>>((ref) {
  final status = ref.watch(hmoClaimsFilterProvider);
  return ref.read(clinicalRepositoryProvider).getHmoClaims(status: status);
});

// ── Billing Officer — HMO Claims Screen ──────────────────────────────────────

class HmoClaimsScreen extends ConsumerWidget {
  const HmoClaimsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final claimsAsync = ref.watch(hmoClaimsProvider);
    final filter = ref.watch(hmoClaimsFilterProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('HMO / NHIA Claims'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(hmoClaimsProvider),
          ),
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () => ref.read(authProvider.notifier).logout(),
          ),
        ],
      ),
      body: Column(
        children: [
          // ── Status filter chips ──────────────────────────────────────────
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
            child: Row(
              children: [
                for (final s in [
                  null,
                  'approved',
                  'rejected',
                  'manual_review',
                  'pending',
                ])
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: FilterChip(
                      label: Text(s ?? 'All'),
                      selected: filter == s,
                      onSelected: (_) => ref
                          .read(hmoClaimsFilterProvider.notifier)
                          .state = s,
                    ),
                  ),
              ],
            ),
          ),
          // ── List ────────────────────────────────────────────────────────
          Expanded(
            child: claimsAsync.when(
              loading: () =>
                  const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(child: Text('Error: $e')),
              data: (claims) {
                if (claims.isEmpty) {
                  return const Center(child: Text('No claims found.'));
                }
                return RefreshIndicator(
                  onRefresh: () async =>
                      ref.invalidate(hmoClaimsProvider),
                  child: ListView.separated(
                    padding: const EdgeInsets.all(12),
                    itemCount: claims.length,
                    separatorBuilder: (_, __) =>
                        const SizedBox(height: 8),
                    itemBuilder: (context, i) =>
                        _ClaimCard(claim: claims[i]),
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

// ── Claim list card ───────────────────────────────────────────────────────────

class _ClaimCard extends StatelessWidget {
  const _ClaimCard({required this.claim});
  final HmoClaim claim;

  @override
  Widget build(BuildContext context) {
    final (color, label) = _statusStyle(claim.status);
    final dateStr = claim.createdAt != null
        ? DateFormat('dd MMM yyyy').format(claim.createdAt!)
        : '—';

    return Card(
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: color.withOpacity(0.15),
          child: Icon(Icons.medical_services, color: color, size: 20),
        ),
        title: Text(
          'Policy: ${claim.policyId}',
          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
        ),
        subtitle: Text(
          '$dateStr · Service ${claim.serviceCode} · '
          '₦${claim.requestedNaira.toStringAsFixed(2)}',
          style: const TextStyle(fontSize: 12),
        ),
        trailing: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(
            color: color.withOpacity(0.12),
            borderRadius: BorderRadius.circular(4),
            border: Border.all(color: color),
          ),
          child: Text(label,
              style: TextStyle(
                  color: color,
                  fontWeight: FontWeight.bold,
                  fontSize: 11)),
        ),
        onTap: () => Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => HmoClaimDetailScreen(claim: claim),
        )),
      ),
    );
  }

  (Color, String) _statusStyle(String status) => switch (status) {
    'approved'       => (Colors.green, 'APPROVED'),
    'partially_paid' => (Colors.teal, 'PARTIAL'),
    'rejected'       => (Colors.red, 'REJECTED'),
    'manual_review'  => (Colors.orange, 'REVIEW'),
    _                => (Colors.grey, 'PENDING'),
  };
}

// ── Claim detail + resolve screen ─────────────────────────────────────────────

class HmoClaimDetailScreen extends ConsumerStatefulWidget {
  const HmoClaimDetailScreen({super.key, required this.claim});
  final HmoClaim claim;

  @override
  ConsumerState<HmoClaimDetailScreen> createState() =>
      _HmoClaimDetailScreenState();
}

class _HmoClaimDetailScreenState
    extends ConsumerState<HmoClaimDetailScreen> {
  late HmoClaim _claim;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _claim = widget.claim;
  }

  Future<void> _resolve(String resolution) async {
    setState(() { _busy = true; _error = null; });
    try {
      final result = await ref
          .read(clinicalRepositoryProvider)
          .resolveHmoClaim(claimId: _claim.id, resolution: resolution);
      final updated = HmoClaim.fromJson(
          Map<String, dynamic>.from(result['claim'] as Map));
      setState(() => _claim = updated);
      ref.invalidate(hmoClaimsProvider);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = _claim;
    return Scaffold(
      appBar: AppBar(title: const Text('HMO Claim Detail')),
      body: _busy
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(_error!,
                        style: const TextStyle(color: Colors.red)),
                  ),
                _Section(
                  title: 'Claim Summary',
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _Row('Status', c.status.toUpperCase()),
                      _Row('Policy ID', c.policyId),
                      _Row('Service Code', c.serviceCode.toString()),
                      _Row('Requested',
                          '₦${c.requestedNaira.toStringAsFixed(2)}'),
                      if (c.payoutAmountKobo > 0)
                        _Row('Approved Payout',
                            '₦${c.payoutNaira.toStringAsFixed(2)}'),
                      if (c.reasonText != null)
                        _Row('Reason', c.reasonText!),
                      if (c.stellarTxHash != null)
                        _Row('Stellar TX',
                            '${c.stellarTxHash!.substring(0, 12)}…'),
                      if (c.createdAt != null)
                        _Row('Date',
                            DateFormat('dd MMM yyyy HH:mm')
                                .format(c.createdAt!)),
                    ],
                  ),
                ),
                // ── Manual review resolution ──────────────────────────
                if (c.needsReview) ...[
                  const SizedBox(height: 16),
                  const Text(
                    'This claim requires manual review.',
                    style: TextStyle(fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: ElevatedButton.icon(
                          onPressed:
                              _busy ? null : () => _resolve('approved'),
                          icon: const Icon(Icons.check_circle),
                          label: const Text('Approve'),
                          style: ElevatedButton.styleFrom(
                              backgroundColor: Colors.green,
                              foregroundColor: Colors.white),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed:
                              _busy ? null : () => _resolve('rejected'),
                          icon: const Icon(Icons.cancel,
                              color: Colors.red),
                          label: const Text('Reject',
                              style: TextStyle(color: Colors.red)),
                        ),
                      ),
                    ],
                  ),
                ],
              ],
            ),
    );
  }
}

// ── Patient coverage view — shows HMO claim status on a bill ─────────────────

class PatientCoverageView extends ConsumerWidget {
  const PatientCoverageView(
      {super.key, required this.invoiceId});
  final String invoiceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Load any HMO claim for this invoice
    final claimsAsync = ref.watch(
      FutureProvider.autoDispose<List<HmoClaim>>((r) =>
          r.read(clinicalRepositoryProvider)
              .getHmoClaims(invoiceId: invoiceId)),
    );

    return claimsAsync.when(
      loading: () => const Padding(
        padding: EdgeInsets.all(8),
        child: LinearProgressIndicator(),
      ),
      error: (_, __) => const SizedBox.shrink(),
      data: (claims) {
        if (claims.isEmpty) return const SizedBox.shrink();
        final claim = claims.first;
        final (color, label) = switch (claim.status) {
          'approved'      => (Colors.green, 'HMO APPROVED'),
          'rejected'      => (Colors.red, 'HMO REJECTED'),
          'manual_review' => (Colors.orange, 'HMO UNDER REVIEW'),
          _               => (Colors.grey, 'HMO PENDING'),
        };
        return Container(
          margin: const EdgeInsets.only(top: 8),
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: color.withOpacity(0.08),
            borderRadius: BorderRadius.circular(6),
            border: Border.all(color: color.withOpacity(0.4)),
          ),
          child: Row(
            children: [
              Icon(Icons.shield_outlined, color: color, size: 18),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(label,
                        style: TextStyle(
                            color: color,
                            fontWeight: FontWeight.bold,
                            fontSize: 12)),
                    if (claim.isApproved)
                      Text(
                        'Coverage: ₦${claim.payoutNaira.toStringAsFixed(2)}',
                        style: const TextStyle(fontSize: 12),
                      ),
                    if (claim.reasonText != null && claim.reasonText!.isNotEmpty)
                      Text(claim.reasonText!,
                          style: TextStyle(
                              fontSize: 11,
                              color: Colors.grey.shade700)),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

// ── Shared widgets ────────────────────────────────────────────────────────────

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.child});
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) => Card(
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

class _Row extends StatelessWidget {
  const _Row(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(
          children: [
            SizedBox(
              width: 100,
              child: Text(label,
                  style: TextStyle(
                      color: Colors.grey.shade600, fontSize: 13)),
            ),
            Expanded(
                child:
                    Text(value, style: const TextStyle(fontSize: 13))),
          ],
        ),
      );
}
