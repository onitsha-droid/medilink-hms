import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:uuid/uuid.dart';

import '../api/clinical_models.dart';
import '../../features/nurse/nurse_triage_screen.dart';

/// Box names for offline storage
const kQueueCacheBox = 'medilink_queue_cache';
const kPatientRecordsBox = 'medilink_patient_records';
const kVitalsSyncQueueBox = 'medilink_vitals_sync_queue';

/// Cached queue item
class CachedQueueData {
  const CachedQueueData({
    required this.position,
    required this.estimatedWaitMinutes,
    required this.clinicId,
    required this.isUrgent,
    required this.cachedAt,
  });

  final int position;
  final int estimatedWaitMinutes;
  final String clinicId;
  final bool isUrgent;
  final DateTime cachedAt;

  Map<String, dynamic> toJson() => {
        'position': position,
        'estimatedWaitMinutes': estimatedWaitMinutes,
        'clinicId': clinicId,
        'isUrgent': isUrgent,
        'cachedAt': cachedAt.toIso8601String(),
      };

  factory CachedQueueData.fromJson(Map<String, dynamic> json) => CachedQueueData(
        position: (json['position'] as num?)?.toInt() ?? 0,
        estimatedWaitMinutes:
            (json['estimatedWaitMinutes'] as num?)?.toInt() ?? 0,
        clinicId: json['clinicId']?.toString() ?? '',
        isUrgent: json['isUrgent'] == true,
        cachedAt: DateTime.tryParse(json['cachedAt']?.toString() ?? '') ??
            DateTime.now(),
      );
}

/// Cached patient record
class CachedPatientRecord {
  const CachedPatientRecord({
    required this.encounters,
    required this.notes,
    required this.vitals,
    required this.cachedAt,
  });

  final List<Encounter> encounters;
  final List<ClinicalNote> notes;
  final List<VitalsRecord> vitals;
  final DateTime cachedAt;
}

/// Queued vitals entry for offline submission
class QueuedVitalsEntry {
  const QueuedVitalsEntry({
    required this.id,
    required this.queueEntryId,
    required this.patientName,
    required this.data,
    required this.clientTimestamp,
    this.status = 'pending',
  });

  final String id;
  final String queueEntryId;
  final String patientName;
  final Map<String, dynamic> data;
  final DateTime clientTimestamp;
  final String status; // 'pending' | 'syncing' | 'synced' | 'conflict'

  Map<String, dynamic> toJson() => {
        'id': id,
        'queueEntryId': queueEntryId,
        'patientName': patientName,
        'data': data,
        'clientTimestamp': clientTimestamp.toIso8601String(),
        'status': status,
      };

  factory QueuedVitalsEntry.fromJson(Map<String, dynamic> json) =>
      QueuedVitalsEntry(
        id: json['id'] as String,
        queueEntryId: json['queueEntryId'] as String,
        patientName: json['patientName'] as String? ?? 'Patient',
        data: Map<String, dynamic>.from(json['data'] as Map),
        clientTimestamp:
            DateTime.tryParse(json['clientTimestamp']?.toString() ?? '') ??
                DateTime.now(),
        status: json['status'] as String? ?? 'pending',
      );
}

/// Sync result report
class SyncReport {
  const SyncReport({
    required this.syncedCount,
    required this.conflictCount,
    required this.errorCount,
  });

  final int syncedCount;
  final int conflictCount;
  final int errorCount;
}

/// OfflineSyncService handles read-cache and write-sync queue via Hive.
class OfflineSyncService {
  OfflineSyncService({
    Box<String>? queueBox,
    Box<String>? recordBox,
    Box<String>? syncBox,
    bool? isInMemory,
  })  : _queueBox = queueBox,
        _recordBox = recordBox,
        _syncBox = syncBox,
        isInMemory = isInMemory ?? !isHiveInitialized;

  /// Flag set to true in main() after Hive.initFlutter() has completed.
  /// When false (e.g. In widget test environments), in-memory stores are used
  /// automatically without throwing uninitialized Hive errors.
  static bool isHiveInitialized = false;

  final bool isInMemory;
  final Box<String>? _queueBox;
  final Box<String>? _recordBox;
  final Box<String>? _syncBox;
  final Map<String, Map<String, String>> _memStores = {};

  Future<Box<String>?> _getBox(String name) async {
    if (name == kQueueCacheBox && _queueBox != null) return _queueBox;
    if (name == kPatientRecordsBox && _recordBox != null) return _recordBox;
    if (name == kVitalsSyncQueueBox && _syncBox != null) return _syncBox;

    try {
      if (Hive.isBoxOpen(name)) {
        return Hive.box<String>(name);
      }
      return await Hive.openBox<String>(name);
    } catch (_) {
      return null;
    }
  }

  Future<void> _put(String boxName, String key, String value) async {
    if (isInMemory) {
      _memStores.putIfAbsent(boxName, () => {})[key] = value;
      return;
    }
    try {
      final box = await _getBox(boxName);
      if (box != null) {
        await box.put(key, value);
        return;
      }
    } catch (_) {}
    _memStores.putIfAbsent(boxName, () => {})[key] = value;
  }

  Future<String?> _get(String boxName, String key) async {
    if (isInMemory) {
      return _memStores[boxName]?[key];
    }
    try {
      final box = await _getBox(boxName);
      if (box != null) {
        return box.get(key) ?? _memStores[boxName]?[key];
      }
    } catch (_) {}
    return _memStores[boxName]?[key];
  }

  Future<void> _delete(String boxName, String key) async {
    if (isInMemory) {
      _memStores[boxName]?.remove(key);
      return;
    }
    try {
      final box = await _getBox(boxName);
      if (box != null) {
        await box.delete(key);
        return;
      }
    } catch (_) {}
    _memStores[boxName]?.remove(key);
  }

  Future<List<String>> _getAll(String boxName) async {
    if (isInMemory) {
      return _memStores[boxName]?.values.toList() ?? [];
    }
    try {
      final box = await _getBox(boxName);
      if (box != null) {
        final list = <String>[];
        for (final key in box.keys) {
          final val = box.get(key);
          if (val != null) list.add(val);
        }
        return list;
      }
    } catch (_) {}
    return _memStores[boxName]?.values.toList() ?? [];
  }

  // ── 1. Live Queue Read Cache ───────────────────────────────────────────────

  Future<void> cacheQueuePosition(
    String patientId, {
    required int position,
    required int estimatedWaitMinutes,
    required String clinicId,
    required bool isUrgent,
  }) async {
    final entry = CachedQueueData(
      position: position,
      estimatedWaitMinutes: estimatedWaitMinutes,
      clinicId: clinicId,
      isUrgent: isUrgent,
      cachedAt: DateTime.now(),
    );
    await _put(kQueueCacheBox, 'queue_$patientId', jsonEncode(entry.toJson()));
  }

  Future<CachedQueueData?> getCachedQueuePosition(String patientId) async {
    try {
      final raw = await _get(kQueueCacheBox, 'queue_$patientId');
      if (raw == null) return null;
      final map = jsonDecode(raw) as Map<String, dynamic>;
      return CachedQueueData.fromJson(map);
    } catch (_) {
      return null;
    }
  }

  // ── 2. Patient Record Read Cache (recently opened) ─────────────────────────

  Future<void> cachePatientRecord(
    String patientId,
    Map<String, dynamic> rawResponse,
  ) async {
    final payload = {
      'data': rawResponse,
      'cachedAt': DateTime.now().toIso8601String(),
    };
    await _put(kPatientRecordsBox, 'record_$patientId', jsonEncode(payload));
  }

  Future<CachedPatientRecord?> getCachedPatientRecord(String patientId) async {
    try {
      final raw = await _get(kPatientRecordsBox, 'record_$patientId');
      if (raw == null) return null;
      final decoded = jsonDecode(raw) as Map<String, dynamic>;
      final data = decoded['data'] as Map<String, dynamic>;
      final cachedAt =
          DateTime.tryParse(decoded['cachedAt']?.toString() ?? '') ??
              DateTime.now();

      final encounters = (data['encounters'] as List? ?? [])
          .map((e) => Encounter.fromJson(Map<String, dynamic>.from(e as Map)))
          .toList();
      final notes = (data['notes'] as List? ?? [])
          .map((n) => ClinicalNote.fromJson(Map<String, dynamic>.from(n as Map)))
          .toList();
      final vitals = (data['vitals'] as List? ?? [])
          .map((v) => VitalsRecord.fromJson(Map<String, dynamic>.from(v as Map)))
          .toList();

      return CachedPatientRecord(
        encounters: encounters,
        notes: notes,
        vitals: vitals,
        cachedAt: cachedAt,
      );
    } catch (_) {
      return null;
    }
  }

  // ── 3. Nurse Vitals Sync Queue ─────────────────────────────────────────────

  Future<QueuedVitalsEntry> queueVitals({
    required String queueEntryId,
    required String patientName,
    required Map<String, dynamic> vitalsData,
    DateTime? clientTimestamp,
  }) async {
    final entry = QueuedVitalsEntry(
      id: const Uuid().v4(),
      queueEntryId: queueEntryId,
      patientName: patientName,
      data: vitalsData,
      clientTimestamp: clientTimestamp ?? DateTime.now(),
      status: 'pending',
    );
    await _put(kVitalsSyncQueueBox, entry.id, jsonEncode(entry.toJson()));
    return entry;
  }

  Future<List<QueuedVitalsEntry>> getQueuedVitals() async {
    try {
      final rawList = await _getAll(kVitalsSyncQueueBox);
      final list = <QueuedVitalsEntry>[];
      for (final raw in rawList) {
        list.add(QueuedVitalsEntry.fromJson(
            jsonDecode(raw) as Map<String, dynamic>));
      }
      list.sort((a, b) => a.clientTimestamp.compareTo(b.clientTimestamp));
      return list;
    } catch (_) {
      return [];
    }
  }

  Future<void> removeQueuedVitals(String id) async {
    await _delete(kVitalsSyncQueueBox, id);
  }

  /// Syncs all queued vitals with conflict handling by timestamp.
  Future<SyncReport> syncQueuedVitals(VitalsRepository repo) async {
    final queued = await getQueuedVitals();
    if (queued.isEmpty) {
      return const SyncReport(syncedCount: 0, conflictCount: 0, errorCount: 0);
    }

    // Deduplicate by queueEntryId: keep only the newest item per queue entry
    final newestByEntry = <String, QueuedVitalsEntry>{};
    final olderDuplicates = <QueuedVitalsEntry>[];

    for (final item in queued) {
      final existing = newestByEntry[item.queueEntryId];
      if (existing == null) {
        newestByEntry[item.queueEntryId] = item;
      } else {
        if (item.clientTimestamp.isAfter(existing.clientTimestamp)) {
          olderDuplicates.add(existing);
          newestByEntry[item.queueEntryId] = item;
        } else {
          olderDuplicates.add(item);
        }
      }
    }

    for (final dup in olderDuplicates) {
      await removeQueuedVitals(dup.id);
    }

    int synced = 0;
    int conflicts = 0;
    int errors = 0;

    for (final item in newestByEntry.values) {
      try {
        final serverVitals = await repo.getVitalsByEntry(item.queueEntryId);

        if (serverVitals != null) {
          final serverRecordedAt = DateTime.tryParse(
            serverVitals['createdAt']?.toString() ??
                serverVitals['recordedAt']?.toString() ??
                '',
          );
          if (serverRecordedAt != null &&
              serverRecordedAt.isAfter(item.clientTimestamp)) {
            // Conflict: Server has newer vitals — server wins
            conflicts++;
            await removeQueuedVitals(item.id);
            continue;
          }
        }

        final formData = VitalsFormData(
          bpSystolic: (item.data['bpSystolic'] as num?)?.toDouble(),
          bpDiastolic: (item.data['bpDiastolic'] as num?)?.toDouble(),
          spo2: (item.data['spo2'] as num?)?.toDouble(),
          weightKg: (item.data['weightKg'] as num?)?.toDouble(),
          temperatureCelsius:
              (item.data['temperatureCelsius'] as num?)?.toDouble(),
          heartRateBpm: (item.data['heartRateBpm'] as num?)?.toDouble(),
          notes: item.data['notes'] as String?,
          isUrgent: item.data['isUrgent'] == true,
          urgentReason: item.data['urgentReason'] as String?,
        );

        await repo.recordVitals(item.queueEntryId, formData);
        await removeQueuedVitals(item.id);
        synced++;
      } catch (e) {
        errors++;
      }
    }

    return SyncReport(
      syncedCount: synced,
      conflictCount: conflicts,
      errorCount: errors,
    );
  }
}

// ── Riverpod Provider ────────────────────────────────────────────────────────

final offlineSyncServiceProvider = Provider<OfflineSyncService>((ref) {
  return OfflineSyncService();
});
