import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:socket_io_client/socket_io_client.dart' as sio;
import '../../core/api/api_client.dart';
import '../../core/offline/offline_sync_service.dart';
import '../../core/socket/socket_provider.dart';
import 'queue_models.dart';

// ── REST repository ───────────────────────────────────────────────────────────

final queueRepositoryProvider = Provider<QueueRepository>((ref) {
  return QueueRepository(ref.read(apiClientProvider));
});

class QueueRepository {
  const QueueRepository(this._api);
  final ApiClient _api;

  Future<CheckInResponse> checkIn(CheckInRequest req) async {
    final res = await _api.dio.post<Map<String, dynamic>>(
      '/queue/check-in',
      data: req.toJson(),
    );
    return CheckInResponse.fromJson(res.data! as Map<String, dynamic>);
  }
}

// ── Live queue position state ─────────────────────────────────────────────────

sealed class QueueState {
  const QueueState();
}

class QueueStateIdle extends QueueState {
  const QueueStateIdle();
}

class QueueStateLoading extends QueueState {
  const QueueStateLoading();
}

class QueueStateActive extends QueueState {
  const QueueStateActive({
    required this.position,
    required this.estimatedWaitMinutes,
    required this.clinicId,
    this.isUrgent = false,
    this.isFromCache = false,
    this.cachedAt,
  });
  final int position;
  final int estimatedWaitMinutes;
  final String clinicId;
  final bool isUrgent;
  final bool isFromCache;
  final DateTime? cachedAt;
}

class QueueStateError extends QueueState {
  const QueueStateError(this.message);
  final String message;
}

class QueueStateDisconnected extends QueueState {
  const QueueStateDisconnected();
}

// ── Provider ──────────────────────────────────────────────────────────────────

/// Subscribes to `queue:position` / `queue:urgent` socket events for a patient.
/// Family parameter is the patient's Mongo _id string.
final queuePositionProvider = StateNotifierProvider.family<
    QueuePositionNotifier, QueueState, String>((ref, patientId) {
  final socket = ref.watch(socketProvider);
  return QueuePositionNotifier(socket, patientId, ref);
});

class QueuePositionNotifier extends StateNotifier<QueueState> {
  QueuePositionNotifier(this._socket, this._patientId, this._ref, [QueueState? initialState])
      : super(initialState ?? const QueueStateLoading()) {
    if (initialState == null) {
      _subscribe();
    }
  }

  final sio.Socket? _socket;
  final String _patientId;
  final Ref? _ref;

  void _subscribe() {
    // Check offline cache first
    final offlineSync = _ref?.read(offlineSyncServiceProvider);
    if (offlineSync != null) {
      offlineSync.getCachedQueuePosition(_patientId).then((cached) {
        if (cached != null && state is! QueueStateActive) {
          state = QueueStateActive(
            position: cached.position,
            estimatedWaitMinutes: cached.estimatedWaitMinutes,
            clinicId: cached.clinicId,
            isUrgent: cached.isUrgent,
            isFromCache: true,
            cachedAt: cached.cachedAt,
          );
        }
      });
    }

    final socket = _socket;
    if (socket == null) {
      if (offlineSync != null) {
        offlineSync.getCachedQueuePosition(_patientId).then((cached) {
          if (cached != null) {
            state = QueueStateActive(
              position: cached.position,
              estimatedWaitMinutes: cached.estimatedWaitMinutes,
              clinicId: cached.clinicId,
              isUrgent: cached.isUrgent,
              isFromCache: true,
              cachedAt: cached.cachedAt,
            );
          } else {
            state = const QueueStateDisconnected();
          }
        });
      } else {
        state = const QueueStateDisconnected();
      }
      return;
    }

    // Join own patient room
    socket.emitWithAck('join:patient', {'patientId': _patientId},
        ack: (dynamic data) {
      if (data is Map && data['error'] != null) {
        state = QueueStateError(data['error'].toString());
      }
    });

    socket.on('queue:position', (dynamic data) {
      if (data is Map) {
        final pos = (data['position'] as num).toInt();
        final wait = (data['estimatedWaitMinutes'] as num?)?.toInt() ?? 0;
        final clinic = data['clinicId']?.toString() ?? '';
        final current = state;
        final isUrgent = current is QueueStateActive ? current.isUrgent : false;

        state = QueueStateActive(
          position: pos,
          estimatedWaitMinutes: wait,
          clinicId: clinic,
          isUrgent: isUrgent,
          isFromCache: false,
        );

        offlineSync?.cacheQueuePosition(
          _patientId,
          position: pos,
          estimatedWaitMinutes: wait,
          clinicId: clinic,
          isUrgent: isUrgent,
        );
      }
    });

    socket.on('queue:urgent', (dynamic _) {
      final current = state;
      if (current is QueueStateActive) {
        state = QueueStateActive(
          position: current.position,
          estimatedWaitMinutes: current.estimatedWaitMinutes,
          clinicId: current.clinicId,
          isUrgent: true,
          isFromCache: current.isFromCache,
          cachedAt: current.cachedAt,
        );
      }
    });

    socket.on('disconnect', (dynamic _) {
      final current = state;
      if (current is QueueStateActive) {
        state = QueueStateActive(
          position: current.position,
          estimatedWaitMinutes: current.estimatedWaitMinutes,
          clinicId: current.clinicId,
          isUrgent: current.isUrgent,
          isFromCache: true,
          cachedAt: current.cachedAt ?? DateTime.now(),
        );
      } else {
        state = const QueueStateDisconnected();
      }
    });

    // Re-subscribe after reconnect
    socket.on('connect', (dynamic _) => _subscribe());

    state = const QueueStateIdle();
  }

  @override
  void dispose() {
    _socket?.off('queue:position');
    _socket?.off('queue:urgent');
    super.dispose();
  }
}
