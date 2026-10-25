import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'queue_provider.dart';

/// Patient-facing live queue screen.
///
/// Shows the patient's current position, estimated wait time, and connection
/// status. Fed entirely by the Socket.IO provider — no polling.
class PatientQueueScreen extends ConsumerWidget {
  const PatientQueueScreen({super.key, required this.patientId});

  /// The patient's Mongo _id (used to subscribe to the socket room).
  final String patientId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final queueState = ref.watch(queuePositionProvider(patientId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('My Queue Position'),
        actions: [_ConnectionBadge(state: queueState)],
      ),
      body: AnimatedSwitcher(
        duration: const Duration(milliseconds: 300),
        child: _buildBody(context, queueState),
      ),
    );
  }

  Widget _buildBody(BuildContext context, QueueState state) {
    return switch (state) {
      QueueStateLoading() => const Center(
          key: Key('queue_loading'),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircularProgressIndicator(),
              SizedBox(height: 16),
              Text('Connecting to queue…'),
            ],
          ),
        ),
      QueueStateDisconnected() => _DisconnectedView(
          key: const Key('queue_disconnected'),
        ),
      QueueStateError(:final message) => _ErrorView(
          key: const Key('queue_error'),
          message: message,
        ),
      QueueStateIdle() => const Center(
          key: Key('queue_idle'),
          child: Text('Waiting for queue updates…'),
        ),
      QueueStateActive(
        :final position,
        :final estimatedWaitMinutes,
        :final isUrgent,
      ) =>
        _ActiveQueueView(
          key: const Key('queue_active'),
          position: position,
          estimatedWaitMinutes: estimatedWaitMinutes,
          isUrgent: isUrgent,
        ),
    };
  }
}

// ── Active queue view ─────────────────────────────────────────────────────────

class _ActiveQueueView extends StatelessWidget {
  const _ActiveQueueView({
    super.key,
    required this.position,
    required this.estimatedWaitMinutes,
    required this.isUrgent,
  });

  final int position;
  final int estimatedWaitMinutes;
  final bool isUrgent;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (isUrgent) ...[
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: Colors.red.shade100,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.priority_high,
                        color: Colors.red, size: 16),
                    const SizedBox(width: 4),
                    Text(
                      'URGENT — Moved to front',
                      key: const Key('urgent_banner'),
                      style: TextStyle(
                          color: Colors.red.shade800,
                          fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
            ],

            // Position circle
            Container(
              width: 140,
              height: 140,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: theme.colorScheme.primaryContainer,
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    '$position',
                    key: const Key('queue_position_number'),
                    style: theme.textTheme.displayLarge?.copyWith(
                      color: theme.colorScheme.onPrimaryContainer,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  Text(
                    'in queue',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onPrimaryContainer,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            Text(
              position == 1
                  ? "You're next!"
                  : 'Estimated wait',
              style: theme.textTheme.titleMedium,
            ),
            if (position > 1) ...[
              const SizedBox(height: 4),
              Text(
                _formatWait(estimatedWaitMinutes),
                key: const Key('queue_wait_time'),
                style: theme.textTheme.headlineSmall?.copyWith(
                  color: theme.colorScheme.primary,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
            const SizedBox(height: 32),
            Text(
              'Updates are live. No need to refresh.',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: Colors.grey.shade500),
            ),
          ],
        ),
      ),
    );
  }

  String _formatWait(int minutes) {
    if (minutes < 1) return 'Less than a minute';
    if (minutes == 1) return '~1 minute';
    if (minutes < 60) return '~$minutes minutes';
    final h = minutes ~/ 60;
    final m = minutes % 60;
    return m == 0 ? '~$h hr' : '~$h hr $m min';
  }
}

// ── Disconnected view ─────────────────────────────────────────────────────────

class _DisconnectedView extends StatelessWidget {
  const _DisconnectedView({super.key});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.wifi_off, size: 64, color: Colors.grey.shade400),
          const SizedBox(height: 16),
          const Text(
            'Disconnected',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          Text(
            'Trying to reconnect automatically…',
            style: TextStyle(color: Colors.grey.shade600),
          ),
        ],
      ),
    );
  }
}

// ── Error view ────────────────────────────────────────────────────────────────

class _ErrorView extends StatelessWidget {
  const _ErrorView({super.key, required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, size: 64, color: Colors.red),
            const SizedBox(height: 16),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.red),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Connection status badge in AppBar ─────────────────────────────────────────

class _ConnectionBadge extends StatelessWidget {
  const _ConnectionBadge({required this.state});
  final QueueState state;

  @override
  Widget build(BuildContext context) {
    final (color, label) = switch (state) {
      QueueStateDisconnected() => (Colors.red, 'Offline'),
      QueueStateLoading() => (Colors.orange, 'Connecting'),
      _ => (Colors.green, 'Live'),
    };

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(shape: BoxShape.circle, color: color),
          ),
          const SizedBox(width: 4),
          Text(label,
              style: const TextStyle(fontSize: 12, color: Colors.white)),
        ],
      ),
    );
  }
}
